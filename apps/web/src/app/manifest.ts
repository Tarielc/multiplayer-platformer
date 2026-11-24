import type { MetadataRoute } from 'next';
import { GAME_TITLE } from '@/components/brand';

/**
 * Web app manifest: added to a home screen (the iPhone route to full screen, see
 * FullscreenPrompt), the game opens without browser bars.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: GAME_TITLE,
    short_name: GAME_TITLE,
    description: 'An online platformer for 1-4 players: team up against the rhino or race to the trophy.',
    start_url: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    background_color: '#07110d',
    theme_color: '#07110d',
  };
}
