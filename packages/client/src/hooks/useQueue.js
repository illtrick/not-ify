import { useState } from 'react';

export function useQueue() {
  const [queue, setQueue] = useState([]);
  const [showQueue, setShowQueue] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  function addToQueue(track) {
    setQueue(prev => [...prev, track]);
  }

  function removeFromQueue(index) {
    setQueue(prev => prev.filter((_, i) => i !== index));
  }

  function clearQueue() {
    setQueue([]);
  }

  return {
    queue, setQueue,
    showQueue, setShowQueue,
    dragIdx, setDragIdx,
    dragOverIdx, setDragOverIdx,
    addToQueue, removeFromQueue, clearQueue,
  };
}
