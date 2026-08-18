import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

const QDIR       = path.join(os.homedir(), '.qdash');
const BRIDGE_DIR = path.join(QDIR, 'bridge');
const TRIGGER    = path.join(BRIDGE_DIR, 'trigger.json');
const SEMANTIC   = path.join(process.cwd(), '..', 'output', 'semantic-events.json');

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let lastTrigger = 0;
      let lastSemanticSize = 0;
      let closed = false;

      // Send initial state
      const send = (data: any, event = 'message') => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      send({ type: 'connected', ts: Date.now() }, 'system');

      // Poll for new events
      const interval = setInterval(() => {
        if (closed) return;
        try {
          // Check semantic-events.json for new lines
          if (fs.existsSync(SEMANTIC)) {
            const stat = fs.statSync(SEMANTIC);
            if (stat.size > lastSemanticSize) {
              lastSemanticSize = stat.size;
              // Read last 20 lines
              const content = fs.readFileSync(SEMANTIC, 'utf8');
              const lines = content.split('\n').filter(Boolean);
              const recent = lines.slice(-20).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
              for (const e of recent) send(e, 'event');
            }
          }
        } catch {}
      }, 800);

      // Heartbeat
      const heartbeat = setInterval(() => {
        if (closed) return;
        send({ ts: Date.now() }, 'heartbeat');
      }, 15000);

      // Cleanup on close
      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
