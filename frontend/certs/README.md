# HTTPS local

Gere os certificados com `mkcert` na pasta `frontend`:

```bash
mkcert -install
mkcert -key-file certs/local-key.pem -cert-file certs/local.pem localhost 127.0.0.1 192.168.15.73
```

Depois inicie o frontend:

```bash
npm run dev:https
```

Abra `https://192.168.15.73:5173`.

Para que celulares e outros computadores não exibam alerta de certificado, instale a autoridade certificadora gerada pelo `mkcert` em cada dispositivo. O certificado `local.pem` sozinho não é a autoridade certificadora.
