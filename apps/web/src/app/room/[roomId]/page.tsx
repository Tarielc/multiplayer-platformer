import type { Metadata } from 'next';
import { isRoomCode, normalizeRoomCode } from '@platformer/shared';
import { notFound } from 'next/navigation';
import { RoomScreen } from '@/components/RoomScreen';

interface RoomPageProps {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: RoomPageProps): Promise<Metadata> {
  const { roomId } = await params;
  return { title: `Room ${normalizeRoomCode(roomId)} · Platformer Template` };
}

export default async function RoomPage({ params, searchParams }: RoomPageProps) {
  const [{ roomId }, query] = await Promise.all([params, searchParams]);
  const code = normalizeRoomCode(decodeURIComponent(roomId));
  if (!isRoomCode(code)) notFound();
  // key: a different room is a different session (fresh client, store and Phaser game).
  return <RoomScreen key={code} roomId={code} solo={query.solo === '1'} />;
}
