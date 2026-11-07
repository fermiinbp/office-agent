// Ayudas HTTP: JSON, lectura del cuerpo y archivos estáticos.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// Error con código HTTP, para que el catch de server.js sepa qué responder.
export function errorHttp(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

export function leerCuerpo(req, limite = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let excedido = false;
    const partes = [];
    req.on('data', (c) => {
      if (excedido) return;
      size += c.length;
      if (size > limite) {
        excedido = true;
        partes.length = 0;
        reject(errorHttp(413, 'Cuerpo demasiado grande'));
        req.resume(); // se descarta el resto para poder responder el 413
      } else partes.push(c);
    });
    req.on('end', () => {
      if (excedido) return;
      try {
        resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {});
      } catch {
        reject(errorHttp(400, 'JSON no válido'));
      }
    });
    req.on('error', reject);
  });
}

export async function servirEstatico(res, raiz, ruta) {
  let decodificada;
  try {
    decodificada = decodeURIComponent(ruta === '/' ? '/index.html' : ruta);
  } catch {
    return json(res, 400, { error: 'Ruta no válida' });
  }
  if (decodificada.includes('\0')) return json(res, 400, { error: 'Ruta no válida' });
  const limpia = normalize(decodificada).replace(/^([/\\])+/, '');
  const archivo = join(raiz, limpia);
  if (!archivo.startsWith(raiz + sep) && archivo !== raiz) return json(res, 403, { error: 'Ruta no permitida' });
  try {
    const st = await stat(archivo);
    if (!st.isFile()) throw new Error('no es archivo');
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(archivo).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    createReadStream(archivo).pipe(res);
  } catch {
    json(res, 404, { error: 'No encontrado' });
  }
}
