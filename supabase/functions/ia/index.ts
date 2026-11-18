// CRM do Cooperado: função de IA (roda no Supabase, nunca no aparelho)
// Faz duas coisas:
//  1. acao "json": recebe um texto e devolve um JSON gerado pelo Claude Haiku (abordagem com IA).
//  2. áudio (multipart): transcreve o áudio (Groq ou OpenAI) e pede ao Haiku para preencher os campos.
// As chaves ficam nos segredos do Supabase (Edge Functions > Secrets), nunca no código nem no app.
//
// Segredos usados:
//   ANTHROPIC_API_KEY   obrigatório
//   GROQ_API_KEY        para transcrever áudio pela Groq (padrão, mais barato)
//   OPENAI_API_KEY      alternativa para transcrever pela OpenAI (use TRANSCRICAO=openai)
//   EMAILS_PERMITIDOS   recomendado: e-mails que podem usar a IA, separados por vírgula
//   MODELO_IA           opcional, padrão claude-haiku-5-5
//   TRANSCRICAO         opcional: groq ou openai
//   MODELO_TRANSCRICAO  opcional: padrão whisper-large-v3-turbo (Groq) ou gpt-4o-mini-transcribe (OpenAI)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODELO = Deno.env.get('MODELO_IA') || 'claude-haiku-5-5';

type Falha = { codigo: string; erro: string; st: number };
const json = (b: unknown, st = 200) =>
  new Response(JSON.stringify(b), { status: st, headers: { ...CORS, 'Content-Type': 'application/json' } });
const falha = (codigo: string, erro: string, st = 400) => json({ codigo, erro }, st);
const erro = (codigo: string, msg: string, st = 500): Falha => ({ codigo, erro: msg, st });

async function usuario(req: Request): Promise<{ email?: string; id?: string } | null> {
  const auth = req.headers.get('Authorization') || '';
  const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const url = Deno.env.get('SUPABASE_URL');
  if (!auth.startsWith('Bearer ') || !url) return null;
  const r = await fetch(url + '/auth/v1/user', { headers: { Authorization: auth, apikey } });
  if (!r.ok) return null;
  return await r.json();
}

// deno-lint-ignore no-explicit-any
async function claude(body: Record<string, unknown>): Promise<any> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw erro('sem_chave', 'Falta a chave da Anthropic nos segredos do Supabase (ANTHROPIC_API_KEY).');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m: string = j?.error?.message || 'HTTP ' + r.status;
    if (r.status === 429) throw erro('rate_limited', 'Limite de uso da IA atingido. Tente de novo em alguns minutos.', 429);
    if (r.status === 401) throw erro('chave_invalida', 'A chave da Anthropic é inválida. Confira o segredo ANTHROPIC_API_KEY.', 502);
    if (/credit|billing|balance/i.test(m)) throw erro('sem_credito', 'Sem crédito na conta da Anthropic. Adicione crédito no console da Anthropic.', 502);
    if (r.status >= 500) throw erro('unavailable', 'A IA está fora do ar agora. Tente de novo em instantes.', 503);
    throw erro('erro_ia', 'Erro da IA: ' + m, 502);
  }
  return j;
}

async function transcrever(audio: File, vocab: string): Promise<string> {
  const prov = (Deno.env.get('TRANSCRICAO') || (Deno.env.get('GROQ_API_KEY') ? 'groq' : 'openai')).toLowerCase();
  const c = prov === 'openai'
    ? { url: 'https://api.openai.com/v1/audio/transcriptions', key: Deno.env.get('OPENAI_API_KEY'), model: Deno.env.get('MODELO_TRANSCRICAO') || 'gpt-4o-mini-transcribe', nome: 'OPENAI_API_KEY' }
    : { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: Deno.env.get('GROQ_API_KEY'), model: Deno.env.get('MODELO_TRANSCRICAO') || 'whisper-large-v3-turbo', nome: 'GROQ_API_KEY' };
  if (!c.key) throw erro('sem_chave', `Falta a chave de transcrição nos segredos do Supabase (${c.nome}).`);
  const fd = new FormData();
  fd.append('file', audio, audio.name || 'audio.webm');
  fd.append('model', c.model);
  fd.append('language', 'pt');
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  if (vocab) fd.append('prompt', vocab.slice(0, 600));
  const r = await fetch(c.url, { method: 'POST', headers: { Authorization: 'Bearer ' + c.key }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 429) throw erro('rate_limited', 'Limite da transcrição atingido. Tente de novo em alguns minutos.', 429);
    if (r.status === 401) throw erro('chave_invalida', `A chave de transcrição é inválida. Confira o segredo ${c.nome}.`, 502);
    if (r.status >= 500) throw erro('unavailable', 'O serviço de transcrição está fora do ar agora.', 503);
    throw erro('erro_transcricao', 'Erro na transcrição: ' + (j?.error?.message || r.status), 502);
  }
  return String(j.text || '').trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return falha('metodo', 'Use POST.', 405);
  try {
    const u = await usuario(req);
    if (!u) return falha('nao_autorizado', 'Sessão expirada. Entre de novo no app.', 401);
    const permitidos = (Deno.env.get('EMAILS_PERMITIDOS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (permitidos.length && !permitidos.includes(String(u.email || '').toLowerCase())) {
      return falha('nao_permitido', 'Este usuário não tem acesso à IA.', 403);
    }

    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const fd = await req.formData();
      const meta = JSON.parse(String(fd.get('meta') || '{}'));
      if (!meta.schema || !meta.sistema) return falha('invalid_request', 'Pedido incompleto.');
      let texto = String(fd.get('texto') || '').trim();
      if (!texto) {
        const audio = fd.get('audio');
        if (!(audio instanceof File)) return falha('sem_audio', 'O áudio não chegou. Grave de novo.');
        if (audio.size > 20 * 1024 * 1024) return falha('too_large', 'Áudio grande demais (máximo 20 MB, cerca de 1 hora).');
        texto = await transcrever(audio, String(meta.vocab || ''));
      }
      if (!texto) return json({ texto: '', dados: { acao: 'nada', resumo_curto: 'Não deu para ouvir nada no áudio.' } });
      const j = await claude({
        max_tokens: 3000,
        temperature: 0,
        system: String(meta.sistema),
        tools: [{ name: 'preencher', description: 'Registra no CRM os dados extraídos do áudio do consultor.', input_schema: meta.schema }],
        tool_choice: { type: 'tool', name: 'preencher' },
        messages: [{ role: 'user', content: 'Transcrição do áudio do consultor:\n"""\n' + texto + '\n"""' }],
      });
      // deno-lint-ignore no-explicit-any
      const tu = (j.content || []).find((c: any) => c.type === 'tool_use');
      return json({ texto, dados: tu ? tu.input : { acao: 'nada', resumo_curto: 'Não entendi o áudio.' }, uso: j.usage });
    }

    const b = await req.json().catch(() => ({}));
    if (b.acao === 'ping') return json({ ok: true, email: u.email, modelo: MODELO });
    if (b.acao === 'json') {
      const j = await claude({
        max_tokens: Math.min(Number(b.max_tokens) || 1500, 4000),
        system: 'Responda apenas com um objeto JSON válido, sem texto antes ou depois.',
        messages: [{ role: 'user', content: String(b.prompt || '') }],
      });
      // deno-lint-ignore no-explicit-any
      const t = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      const m = t.match(/\{[\s\S]*\}/);
      if (!m) return falha('invalid_json', 'A resposta da IA veio incompleta. Tente de novo.', 502);
      try {
        return json({ json: JSON.parse(m[0]), uso: j.usage });
      } catch {
        return falha('invalid_json', 'A resposta da IA veio incompleta. Tente de novo.', 502);
      }
    }
    return falha('acao', 'Ação desconhecida.');
  } catch (e) {
    const f = e as Partial<Falha> & { message?: string };
    return falha(f.codigo || 'erro', f.erro || String(f.message || e), f.st || 500);
  }
});
