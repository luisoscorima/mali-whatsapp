export function readRedisConnection(): { url: string } {
  return {
    url: String(process.env.REDIS_URL || 'redis://localhost:6379').trim(),
  };
}
