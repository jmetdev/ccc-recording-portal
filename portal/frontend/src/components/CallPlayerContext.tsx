import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** Opening a call navigates to its detail page in the content pane. */
export function useCallPlayer() {
  const navigate = useNavigate();
  const openCall = useCallback((id: number) => navigate(`/calls/${id}`), [navigate]);
  return { openCall };
}
