/**
 * SiteCloner Server — Express API with SSE progress streaming.
 */

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { SiteCloner } from './src/engine/cloner.js';
import mime from 'mime-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active jobs
const jobs = new Map();
const CLONES_DIR = path.join(__dirname, 'clones');
fs.mkdirSync(CLONES_DIR, { recursive: true });

/**
 * POST /api/clone — Start a new cloning job.
 */
app.post('/api/clone', (req, res) => {
  const { url, options = {} } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const jobId = uuidv4();
  const outputDir = path.join(CLONES_DIR, jobId);

  const job = {
    id: jobId,
    url,
    status: 'running',
    progress: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    sseClients: [],
  };

  jobs.set(jobId, job);

  // Start cloning in background
  const cloner = new SiteCloner(options);

  cloner.on('progress', (event) => {
    job.progress.push(event);
        if (event && event.phase === 'ai' && event.message) {
          // Print AI progress to the cloning terminal for visibility.
          console.log(`[ai] ${event.message}`);
        }
    // Send to all SSE clients
    for (const client of job.sseClients) {
      client.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });

  cloner.clone(url, outputDir)
    .then(result => {
      job.status = 'completed';
      job.result = result;
      // Notify SSE clients
      for (const client of job.sseClients) {
        client.write(`data: ${JSON.stringify({ phase: 'complete', result })}\n\n`);
        client.end();
      }
      job.sseClients = [];
    })
    .catch(err => {
      job.status = 'failed';
      job.error = err.message;
      // Notify SSE clients
      for (const client of job.sseClients) {
        client.write(`data: ${JSON.stringify({ phase: 'error', error: err.message })}\n\n`);
        client.end();
      }
      job.sseClients = [];
    });

  res.json({ jobId, status: 'started' });
});

/**
 * GET /api/status/:jobId — SSE stream for real-time progress.
 */
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send all existing progress
  for (const event of job.progress) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // If already finished, send result and close
  if (job.status === 'completed') {
    res.write(`data: ${JSON.stringify({ phase: 'complete', result: job.result })}\n\n`);
    res.end();
    return;
  }

  if (job.status === 'failed') {
    res.write(`data: ${JSON.stringify({ phase: 'error', error: job.error })}\n\n`);
    res.end();
    return;
  }

  // Add to SSE clients
  job.sseClients.push(res);

  req.on('close', () => {
    job.sseClients = job.sseClients.filter(c => c !== res);
  });
});

/**
 * GET /api/download/:jobId — Download the ZIP file.
 */
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Job not completed yet' });
  }

  const zipPath = job.result.zipPath;
  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: 'ZIP file not found' });
  }

  // Extract hostname for filename
  let hostname = 'site';
  try {
    const urlObj = new URL(job.url);
    hostname = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  } catch {}

  const friendlyFilename = `${hostname}_clone.zip`;

  // Use Express built-in download method for reliability
  res.download(zipPath, friendlyFilename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to download ZIP' });
    }
  });
});


/**
 * GET /api/preview/:jobId/* — Serve cloned files for live preview.
 */
app.get('/api/preview/:jobId/*', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const cloneDir = path.join(CLONES_DIR, req.params.jobId);
  const requestedPath = req.params[0] || 'index.html';
  const filePath = path.join(cloneDir, requestedPath);

  // Security: ensure the path is within the clone directory
  if (!filePath.startsWith(cloneDir)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  fs.createReadStream(filePath).pipe(res);
});

/**
 * POST /api/reset — Clear all jobs and delete all cloned files.
 */
app.post('/api/reset', (req, res) => {
  try {
    // Clear in-memory jobs
    jobs.clear();

    // Delete and recreate clones directory
    if (fs.existsSync(CLONES_DIR)) {
      fs.rmSync(CLONES_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(CLONES_DIR, { recursive: true });

    res.json({ success: true, message: 'All data cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear data: ' + err.message });
  }
});


/**
 * GET /api/jobs — List recent jobs.
 */
app.get('/api/jobs', (req, res) => {
  const jobList = [];
  for (const [id, job] of jobs) {
    jobList.push({
      id,
      url: job.url,
      status: job.status,
      createdAt: job.createdAt,
      stats: job.result?.stats || null,
      metaInfo: job.result?.metaInfo || null,
      duration: job.result?.duration || null,
    });
  }
  // Sort by creation date descending
  jobList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(jobList);
});

/**
 * GET /api/job/:jobId — Get job details.
 */
app.get('/api/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    id: job.id,
    url: job.url,
    status: job.status,
    createdAt: job.createdAt,
    result: job.result,
    error: job.error,
  });
});

// Fallback to index.html for SPA-like routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ⚡ SiteCloner Server running at http://localhost:${PORT}\n`);
});
