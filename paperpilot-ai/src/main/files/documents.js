'use strict';
/**
 * Lecture du texte d'un document pour l'IA (résumés, questions).
 * Aucun shell : les outils externes (pdftotext, unzip) sont appelés avec des arguments séparés.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PLAIN = new Set(['txt', 'md', 'markdown', 'rst', 'log', 'tex', 'csv', 'tsv', 'json', 'yml', 'yaml', 'xml', 'ini', 'conf', 'toml', 'py', 'js', 'ts', 'java', 'c', 'cpp', 'h', 'rs', 'go', 'rb', 'php', 'sh', 'css', 'sql']);
const ZIP_XML = { docx: 'word/document.xml', odt: 'content.xml', ods: 'content.xml', odp: 'content.xml' };

class DocumentError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 25000, encoding: 'utf8', ...opts }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

const decodeEntities = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function xmlToText(xml) {
  return decodeEntities(
    xml.replace(/<\/(w:p|text:p|text:h|table:table-row)>/g, '\n').replace(/<w:tab\/>|<text:tab\/>/g, '\t').replace(/<w:br\/>|<text:line-break\/>/g, '\n').replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n');
}

async function readDocument(file, { maxChars = 12000 } = {}) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const st = await fs.promises.stat(file);
  if (!st.isFile()) throw new DocumentError('not_file', 'Ce chemin n’est pas un fichier.');
  let text = '';
  let format = ext || 'texte';

  if (PLAIN.has(ext) || ext === '') {
    const fh = await fs.promises.open(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(st.size, 1024 * 1024));
      await fh.read(buf, 0, buf.length, 0);
      if (buf.includes(0)) throw new DocumentError('binary', 'Ce fichier est binaire : son contenu texte ne peut pas être lu.');
      text = buf.toString('utf8');
    } finally { await fh.close(); }
  } else if (ext === 'html' || ext === 'htm') {
    text = (await fs.promises.readFile(file, 'utf8')).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ');
    text = decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
  } else if (ext === 'pdf') {
    if (st.size > 60 * 1024 * 1024) throw new DocumentError('too_big', 'Ce PDF est trop volumineux pour être lu (plus de 60 Mo).');
    try { text = await run('pdftotext', ['-layout', '-enc', 'UTF-8', '-l', '40', file, '-']); }
    catch (e) {
      if (e.code === 'ENOENT') throw new DocumentError('tool_missing', 'L’outil « pdftotext » est absent. Installez-le avec : sudo apt install poppler-utils');
      throw new DocumentError('read_failed', 'Ce PDF n’a pas pu être lu (fichier protégé ou endommagé).');
    }
    if (!text.trim()) throw new DocumentError('no_text', 'Ce PDF ne contient pas de texte exploitable (document scanné ?).');
  } else if (ZIP_XML[ext]) {
    try { text = xmlToText(await run('unzip', ['-p', file, ZIP_XML[ext]])); }
    catch (e) {
      if (e.code === 'ENOENT') throw new DocumentError('tool_missing', 'L’outil « unzip » est absent. Installez-le avec : sudo apt install unzip');
      throw new DocumentError('read_failed', 'Ce document n’a pas pu être lu (fichier protégé ou endommagé).');
    }
  } else {
    throw new DocumentError('unsupported', `Le format « .${ext} » n’est pas pris en charge pour la lecture (formats acceptés : texte, PDF, Word .docx, LibreOffice).`);
  }

  text = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  const truncated = text.length > maxChars;
  return { text: truncated ? text.slice(0, maxChars) : text, truncated, totalChars: text.length, format };
}

module.exports = { readDocument, DocumentError };
