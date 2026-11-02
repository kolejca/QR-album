export type ScannedQr = {
  data: string;
  type: string;
};

export type HandledQr =
  | { kind: 'url'; url: string }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; text: string };

/**
 * Entry point for your business logic after a QR code is read.
 * The scanner only delivers `data` (the encoded string) and `type` (usually `"qr"`).
 */
export function handleScannedQr(scanned: ScannedQr): HandledQr {
  const { data } = scanned;

  if (/^https?:\/\//i.test(data)) {
    return { kind: 'url', url: data };
  }

  try {
    return { kind: 'json', value: JSON.parse(data) };
  } catch {
    return { kind: 'text', text: data };
  }
}

export function formatHandledQr(result: HandledQr): string {
  switch (result.kind) {
    case 'url':
      return result.url;
    case 'json':
      return JSON.stringify(result.value, null, 2);
    case 'text':
      return result.text;
  }
}
