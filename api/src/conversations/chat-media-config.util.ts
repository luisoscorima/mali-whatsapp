export type ChatMediaS3Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  folder: string;
  region: string;
  publicUrlBase: string;
  objectAcl: 'public-read' | null;
};

function unquoteEnv(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

export function getChatMediaS3Config(): ChatMediaS3Config {
  const aclRaw = unquoteEnv(process.env.S3_CHAT_MEDIA_ACL).toLowerCase();

  return {
    accessKeyId: unquoteEnv(process.env.ACCESS_KEY_S3),
    secretAccessKey: unquoteEnv(process.env.SECRET_KEY_S3),
    bucket: unquoteEnv(process.env.BUCKET_NAME),
    folder: unquoteEnv(process.env.CARPETA) || 'assets-whatsapp-mali',
    region: unquoteEnv(process.env.AWS_REGION) || 'us-east-1',
    publicUrlBase: unquoteEnv(process.env.S3_PUBLIC_URL_BASE),
    objectAcl: aclRaw === 'public-read' ? 'public-read' : null,
  };
}

export function isChatMediaS3Configured(): boolean {
  const cfg = getChatMediaS3Config();
  return Boolean(
    cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket && cfg.region,
  );
}

export function assertChatMediaS3Configured(): void {
  if (!isChatMediaS3Configured()) {
    throw new Error(
      'S3 no configurado para media de chat (ACCESS_KEY_S3, SECRET_KEY_S3, BUCKET_NAME, AWS_REGION)',
    );
  }
}
