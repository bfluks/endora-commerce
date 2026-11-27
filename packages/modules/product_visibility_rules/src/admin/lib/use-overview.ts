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
  /** Reads again; resolves with the answer, or `null` when the read failed or a newer one won. */
  readonly reload: () => Promise<ProductVisibilityOverviewResponse | null>;
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

  const reload = useCallback(async (): Promise<ProductVisibilityOverviewResponse | null> => {
    const ticket = ++latest.current;
    setRefreshing(true);
    try {
      const next = await productVisibilityClient.overview();
      if (!mounted.current || ticket !== latest.current) return null;
      setOverview(next);
      setFailed(false);
      return next;
    } catch {
      if (!mounted.current || ticket !== latest.current) return null;
      setFailed(true);
      return null;
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

export interface SalesChannelsState {
  readonly channels: readonly SalesChannelRow[];
  /** The read answered. */
  readonly ready: boolean;
  /** The read failed: the screen says so once, and each row reads "unknown channel". */
  readonly failed: boolean;
}

/**
 * The sales channels, for naming the ones a designation or a website rule points at. A failed
 * read (an operator without `sales_channels:read` included) is not swallowed: the screen says
 * once that the channels could not be loaded, and each row then reads "unknown channel" rather
 * than failing the screen.
 */
export function useSalesChannels(): SalesChannelsState {
  const [state, setState] = useState<SalesChannelsState>({ channels: [], ready: false, failed: false });
  useEffect(() => {
    let live = true;
    productVisibilityClient
      .salesChannels()
      .then((items) => {
        if (live) setState({ channels: Array.isArray(items) ? items : [], ready: true, failed: false });
      })
      .catch(() => {
        if (live) setState({ channels: [], ready: false, failed: true });
      });
    return (): void => {
      live = false;
    };
  }, []);
  return state;
}
