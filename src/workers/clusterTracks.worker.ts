import { groupSimilarTracks } from '../core/routeGeometry';

interface Track {
  summary_polyline?: string | null;
  route_segments?: string[];
  start_date_local: string;
  distance: number;
}

self.onmessage = ({ data }: MessageEvent<Track[]>) => {
  // Keep all original indexes; the page decides whether to expand groups.
  self.postMessage(groupSimilarTracks(data));
};
