# -*- coding: utf-8 -*-
"""Статический сервер проекта, умеющий принимать файлы.

   Обычный python -m http.server только отдаёт. А инструменты в tools/
   собирают модели прямо в браузере — там живёт three.js со всеми
   загрузчиками — и результат надо куда-то положить. Скачивание из
   панели предпросмотра заблокировано, поэтому страница кладёт файл
   обратно на сервер запросом PUT.

   Запуск:  python tools/serve.py [порт]      (по умолчанию 8899)
   Страницу открывать с этого же порта, иначе браузер не пустит PUT.

   Пишет только внутрь папки проекта и только в разрешённые папки —
   случайный PUT не должен затирать исходники.
"""
import os
import sys
import http.server
import socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# куда позволено писать
ALLOW = ('assets/', 'tools/out/')
LIMIT = 64 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.command, self.path))

    def end_headers(self):
        # Иначе браузер держит старый js и правки «не приезжают»: полчаса
        # ищешь ошибку в коде, которого на странице уже нет.
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_PUT(self):
        rel = self.path.lstrip('/').split('?')[0]
        dest = os.path.normpath(os.path.join(ROOT, rel))
        if not dest.startswith(ROOT + os.sep):
            return self.fail(403, 'за пределы проекта писать нельзя')
        if not any(rel.startswith(p) for p in ALLOW):
            return self.fail(403, 'писать можно только в ' + ', '.join(ALLOW))
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > LIMIT:
            return self.fail(413, 'размер %d байт не годится' % n)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            left = n
            while left:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        self.reply(200, 'сохранено %s, %d байт' % (rel, n))

    def fail(self, code, msg):
        self.reply(code, msg)

    def reply(self, code, msg):
        body = msg.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', port), Handler) as srv:
        print('проект на http://127.0.0.1:%d — PUT разрешён в %s' % (port, ', '.join(ALLOW)))
        srv.serve_forever()
