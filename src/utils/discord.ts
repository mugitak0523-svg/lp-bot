import https from 'https';

type DiscordPayload = {
  content: string;
};

export function sendDiscordMessage(webhookUrl: string | undefined, content: string): void {
  if (!webhookUrl) return;

  const url = new URL(webhookUrl);
  const body = JSON.stringify({ content } satisfies DiscordPayload);

  const req = https.request(
    {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res) => {
      res.on('data', () => undefined);
    }
  );

  req.on('error', (error) => {
    console.error('Discord webhook error:', error);
  });

  req.write(body);
  req.end();
}
