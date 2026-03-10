@echo off
curl -s http://127.0.0.1:4040/api/tunnels | findstr "public_url"
