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
 * Persist job metadata to disk for cold-boot recovery.
 */
function saveJobMetadata(jobId, job) {
  try {
    const jobDir = path.join(CLONES_DIR, jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    const metadataPath = path.join(jobDir, 'metadata.json');
    // Don't persist SSE clients
    const { sseClients, ...persistentJob } = job;
    fs.writeFileSync(metadataPath, JSON.stringify(persistentJob, null, 2));
  } catch (err) {
    console.error(`[system] Failed to persist metadata for ${jobId}:`, err);
  }
}

/**
 * Scan clones directory and restore in-memory registry.
 */
function syncJobsFromDisk() {
  console.log('\n  🧪 [sync] Initiating Neural History Sync...');
  if (!fs.existsSync(CLONES_DIR)) return;

  try {
    const entries = fs.readdirSync(CLONES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const jobId = entry.name;
        if (jobId === 'ai') continue;
        
        try {
          const metadataPath = path.join(CLONES_DIR, jobId, 'metadata.json');
          if (fs.existsSync(metadataPath)) {
            // Resilient Read: Attempt to read metadata with structural lock recovery (v3.3)
            let metadataStr;
            try {
              metadataStr = fs.readFileSync(metadataPath, 'utf-8');
            } catch (readErr) {
              if (readErr.code === 'EBUSY') {
                console.warn(`  [sync] Lock detected on ${jobId}. Retrying with neural bypass...`);
                metadataStr = fs.readFileSync(metadataPath, 'utf-8'); // Second attempt
              } else {
                throw readErr;
              }
            }
            const metadata = JSON.parse(metadataStr);
            metadata.sseClients = []; 
            
            // Neural Promotion (v2.12): If metadata says running but ZIP exists, promote it!
            const zipPath = path.join(CLONES_DIR, `${jobId}.zip`);
            if (metadata.status === 'running' && fs.existsSync(zipPath)) {
              console.log(`  [sync] Promoting: ${jobId} (Found ZIP)`);
              metadata.status = 'completed';
              // Minimal result if missing
              if (!metadata.result) metadata.result = { zipPath };
            }
            
            jobs.set(jobId, metadata);
            console.log(`  [sync] Restored: ${jobId} (${metadata.url})`);
          } else {
            const zipPath = path.join(CLONES_DIR, `${jobId}.zip`);
            let birthtime;
            try {
              birthtime = fs.statSync(path.join(CLONES_DIR, jobId)).birthtime;
            } catch {
              birthtime = new Date();
            }
            
            console.log(`  [sync] Discovery (Legacy): ${jobId}`);
            jobs.set(jobId, {
              id: jobId,
              url: 'Unknown (Legacy)',
              status: fs.existsSync(zipPath) ? 'completed' : 'failed',
              createdAt: new Date(birthtime).toISOString(),
              sseClients: [],
              result: fs.existsSync(zipPath) ? { zipPath } : null,
            });
          }
        } catch (jobErr) {
          console.error(`  [sync] Failed folder ${jobId}:`, jobErr.message);
        }
      }
    }
    console.log(`  ⚡ [sync] Neural Sync Complete. ${jobs.size} jobs restored to memory.\n`);
  } catch (err) {
    console.error(`  ❌ [sync] Global Error:`, err.message);
  }
}

// Initial Sync
syncJobsFromDisk();

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
  saveJobMetadata(jobId, job);

  // Start cloning in background
  const cloner = new SiteCloner(options);

  cloner.on('progress', (event) => {
    job.progress.push(event);
    if (event && event.phase === 'ai' && event.message) {
      console.log(`[ai] ${event.message}`);
    }
    
    // Proactive Completion (v2.11): Lock status and result when cloner signals done
    // This state is absolute and cannot be reverted
    if (event && event.phase === 'done') {
      job.status = 'completed';
      if (event.result) job.result = event.result;
      saveJobMetadata(jobId, job);
    }

    // Send to all SSE clients
    for (const client of job.sseClients) {
      client.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });

  cloner.clone(url, outputDir, jobId)
    .then(result => {
      // Final promise resolution (v2.11): Only update if not already proactively completed
      if (job.status !== 'completed') {
        job.status = 'completed';
        job.result = result;
        saveJobMetadata(jobId, job);
      }
      
      // Notify SSE clients with definitive completion signal
      const finalResult = job.result || result;
      for (const client of job.sseClients) {
        client.write(`data: ${JSON.stringify({ phase: 'complete', result: finalResult })}\n\n`);
        client.end();
      }
      job.sseClients = [];
    })
    .catch(err => {
      job.status = 'failed';
      job.error = err.message;
      saveJobMetadata(jobId, job);
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
 * GET /api/jobs — Retrieve all cloning jobs (Absolute Source of Truth).
 * Merged with legacy lists for unified tracking (v3.2)
 */
app.get('/api/jobs', (req, res) => {
  const jobList = Array.from(jobs.values()).map(j => ({
    id: j.id,
    url: j.url,
    status: j.status,
    createdAt: j.createdAt,
    duration: j.result ? j.result.duration : null,
    stats: j.result?.stats || null,
    metaInfo: j.result?.metaInfo || null,
    result: j.result,
    error: j.error
  }));
  
  // Sort by created date descending
  jobList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(jobList);
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
 * GET /api/download/:jobId — Download the ZIP file (Absolute Handshake v3.1).
 */
app.get('/api/download/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  const zipPath = path.join(CLONES_DIR, `${jobId}.zip`);

  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: 'ZIP archive not found for this job ID' });
  }

  // Extract hostname for filename
  let hostname = 'site';
  if (job && job.url) {
    try {
      const urlObj = new URL(job.url);
      hostname = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {}
  }

  const friendlyFilename = `${hostname}_${jobId.slice(0, 8)}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.download(zipPath, friendlyFilename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to download ZIP: ' + err.message });
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
  let filePath = path.join(cloneDir, requestedPath);

  // V8: Smart Multi-Page Resolution
  if (!fs.existsSync(filePath)) {
    // 1. Try appending .html
    if (fs.existsSync(filePath + '.html')) {
        filePath += '.html';
    } 
    // 2. Try appending index.html for directories
    else if (fs.existsSync(path.join(filePath, 'index.html'))) {
        filePath = path.join(filePath, 'index.html');
    }
    // 3. V8 Neural: Search in categorized subdirectories (js/, css/, images/, data/, etc.)
    else {
      const categories = ['js', 'css', 'images', 'fonts', 'videos', 'audio', 'data', 'other'];
      for (const cat of categories) {
        const catPath = path.join(cloneDir, cat, requestedPath);
        if (fs.existsSync(catPath)) {
          filePath = catPath;
          break;
        }
      }
    }
  }

  // Security: ensure the path is within the clone directory
  if (!filePath.startsWith(cloneDir)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!fs.existsSync(filePath)) {
    // Last ditch: check if it's a directory link that should be index.html
    const indexFallback = path.join(filePath, 'index.html');
    if (fs.existsSync(indexFallback)) {
        filePath = indexFallback;
    } else {
        return res.status(404).json({ error: 'File not found: ' + requestedPath });
    }
  }

  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  // V2.19: CORS headers are essential for module scripts and fonts to load in the preview
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  fs.createReadStream(filePath).pipe(res);
});

/**
 * POST /api/reset — Clear all jobs and delete all cloned files.
 */
app.post('/api/reset', async (req, res) => {
  try {
    // Clear in-memory jobs
    jobs.clear();

    // V2.22: Strong Windows EBUSY/EPERM fix using async rm with retries
    if (fs.existsSync(CLONES_DIR)) {
      await fs.promises.rm(CLONES_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    fs.mkdirSync(CLONES_DIR, { recursive: true });

    res.json({ success: true, message: 'All data cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear data: ' + err.message });
  }
});


/**
 * GET /api/job/:jobId — Get a single job's status and result (for polling fallback).
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


app.delete('/api/job/:jobId', async (req, res) => {
  const { jobId } = req.params;
  console.log(`[purge] Neural Discovery Request: ${jobId}`);

  let actualJobId = jobId;
  let job = jobs.get(jobId);

  // Neural Search Fallback: Case-insensitive disk scan (v2.3)
  let jobDir = path.join(CLONES_DIR, jobId);
  let zipPath = path.join(CLONES_DIR, `${jobId}.zip`);
  let folderExists = fs.existsSync(jobDir);
  let zipExists = fs.existsSync(zipPath);

  if (!job && !folderExists && !zipExists) {
    console.log(`[purge] Exact match failed. Initiating Neural Search...`);
    const entries = fs.readdirSync(CLONES_DIR);
    const match = entries.find(e => e.toLowerCase() === jobId.toLowerCase());
    if (match) {
      console.log(`[purge] Neural Search Success: Found match ${match}`);
      actualJobId = match;
      jobDir = path.join(CLONES_DIR, actualJobId);
      zipPath = path.join(CLONES_DIR, `${actualJobId}.zip`);
      folderExists = fs.existsSync(jobDir);
      zipExists = fs.existsSync(zipPath);
      job = jobs.get(actualJobId);
    }
  }

  if (!job && !folderExists && !zipExists) {
    console.error(`[purge] Neural ID Mismatch: ${jobId} not found on disk or memory.`);
    return res.status(404).json({ error: 'Job not found on disk or memory' });
  }

  try {
    // Nuclear Cleanup Fallback (v2.22 logic with retries for Windows locks)
    if (folderExists) {
      await fs.promises.rm(jobDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    if (zipExists) {
      await fs.promises.rm(zipPath, { force: true, maxRetries: 5, retryDelay: 300 });
    }

    // Remove from memory if it exists
    jobs.delete(actualJobId);
    if (jobId !== actualJobId) jobs.delete(jobId);

    console.log(`[purge] Absolute Purge Complete: ${actualJobId}`);
    res.json({ success: true, message: `Job ${actualJobId} and its files purged.` });
  } catch (err) {
    console.error(`[purge] Execution Error:`, err);
    res.status(500).json({ error: 'Failed to purge job: ' + err.message });
  }
});


// Fallback to index.html for SPA-like routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ⚡ SiteCloner Server running at http://localhost:${PORT}\n`);
});
