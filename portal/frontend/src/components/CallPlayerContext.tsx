import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** Opening a call selects it in the Recordings master-detail view. */
export function useCallPlayer() {
  const navigate = useNavigate();
  const openCall = useCallback((id: number) => navigate(`/recordings/${id}`), [navigate]);
  return { openCall };
}
