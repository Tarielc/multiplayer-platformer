'use client';

import { HomeScreen } from '@/components/HomeScreen';
import { ScreenHome } from './ScreenHome';
import { useScreenKind } from './screenEnv';

/** On the CRT or the handheld the home page is a title screen; elsewhere it is the long page. */
export function HomeSwitch() {
  return useScreenKind() ? <ScreenHome /> : <HomeScreen />;
}
