import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductVisibilityOverviewResponse, SalesChannelListResponse } from '@endora-commerce/contracts';
import { productVisibilityClient } from '../api.js';

export interface OverviewState {
  readonly overview: ProductVisibilityOverviewResponse | null;
  /** The first read is in flight: the screen shows its skeleton. */
  readonly loading: boolean;
  /** A later read is in flight: the content stays on screen, marked busy (DS-14). */
  readonly refreshing: boolean;
  readonly failed: boolean;
  readonly reload: () => Promise<void>;
}

/**
 * The configuration overview, read on mount and again after each write. Only the latest read
 * may draw, so an older answer arriving late never overwrites a newer one. Nothing is kept
 * outside the component: a screen that unmounts (sign-out included, TM-14) takes it along.
 */
export function useOverview(): OverviewState {
  const [overview, setOverview] = useState<ProductVisibilityOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(async (): Promise<void> => {
    const ticket = ++latest.current;
    setRefreshing(true);
    try {
      const next = await productVisibilityClient.overview();
      if (!mounted.current || ticket !== latest.current) return;
      setOverview(next);
      setFailed(false);
    } catch {
      if (!mounted.current || ticket !== latest.current) return;
      setFailed(true);
    } finally {
      if (mounted.current && ticket === latest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return (): void => {
      mounted.current = false;
    };
  }, [reload]);

  return { overview, loading, refreshing, failed, reload };
}

export type SalesChannelRow = SalesChannelListResponse['items'][number];

/**
 * The sales channels, for naming the ones a designation or a website rule points at. An
 * operator without `sales_channels:read` gets an empty list, and each row then reads
 * "unknown channel" rather than failing the screen.
 */
export function useSalesChannels(): readonly SalesChannelRow[] {
  const [channels, setChannels] = useState<readonly SalesChannelRow[]>([]);
  useEffect(() => {
    let live = true;
    productVisibilityClient
      .salesChannels()
      .then((items) => {
        if (live && Array.isArray(items)) setChannels(items);
      })
      .catch(() => {
        // Named as unknown below; the screen's own data does not depend on it.
      });
    return (): void => {
      live = false;
    };
  }, []);
  return channels;
}
