import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallPlayer } from '../components/CallPlayerContext';

/** Opens the bottom player drawer and returns to call search. */
export function CallPlayerRedirect() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { openCall } = useCallPlayer();

  useEffect(() => {
    const callId = Number(id);
    if (callId) openCall(callId);
    navigate('/calls', { replace: true });
  }, [id, navigate, openCall]);

  return null;
}
