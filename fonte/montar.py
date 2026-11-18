"""Monta o index.html do app instalável a partir de fonte/app.html.
Uso: python3 fonte/montar.py   (rodar na pasta raiz do repositório)
fonte/app.html é o mesmo código do artifact no Claude; aqui ele ganha o manifesto,
as bibliotecas locais e a ligação com o Supabase (shim.js)."""
import pathlib, re, sys
raiz = pathlib.Path(__file__).resolve().parent.parent
src = (raiz / 'fonte' / 'app.html').read_text(encoding='utf-8')
cdn = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
if cdn not in src:
    sys.exit('Não achei o link do jsPDF em fonte/app.html')
src = src.replace(cdn, 'vendor/jspdf.umd.min.js')
src = re.sub(r'<title>[^<]*</title>\s*', '', src, count=1)
src = src.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
head = '''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>CRM do Cooperado</title>
<meta name="theme-color" content="#3B7A36">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="CRM Coop">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<script src="config.js"></script>
<script src="vendor/supabase.js"></script>
<script src="shim.js"></script>
</head>
<body>
'''
(raiz / 'index.html').write_text(head + src + '\n</body>\n</html>\n', encoding='utf-8')
print('index.html montado:', len(head + src), 'caracteres')
