import https from 'https';

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
};

type DiscordPayload = {
  content?: string;
  embeds?: DiscordEmbed[];
};

type DiscordLevel = 'info' | 'success' | 'warn' | 'error';

const LEVEL_COLOR: Record<DiscordLevel, number> = {
  info: 0x3b82f6,
  success: 0x22c55e,
  warn: 0xf59e0b,
  error: 0xef4444,
};

export function sendDiscordMessage(
  webhookUrl: string | undefined,
  content: string,
  level: DiscordLevel = 'info'
): void {
  if (!webhookUrl) return;

  const url = new URL(webhookUrl);
  const body = JSON.stringify({
    embeds: [
      {
        description: content,
        color: LEVEL_COLOR[level],
      },
    ],
  } satisfies DiscordPayload);

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
