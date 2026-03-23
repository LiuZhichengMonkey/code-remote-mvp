import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { Message } from '../../types';

interface ScrollIndexProps {
  messages: Message[];
  onJump: (id: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export const ScrollIndex = ({
  messages,
  onJump,
  scrollRef
}: ScrollIndexProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrollPercentage, setScrollPercentage] = useState(0);
  const [messagePositions, setMessagePositions] = useState<{ id: string; top: number }[]>([]);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isDragging = useRef(false);

  const userMessages = messages.filter(m => m.role === 'user');

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }

    const handleScroll = () => {
      if (isDragging.current) {
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      const totalScrollable = scrollHeight - clientHeight;
      if (totalScrollable <= 0) {
        setScrollPercentage(0);
      } else {
        setScrollPercentage(scrollTop / totalScrollable);
      }
    };

    const updatePositions = () => {
      const { scrollHeight } = scrollEl;
      if (scrollHeight <= 0) {
        return;
      }

      const positions = userMessages.map(msg => {
        const el = document.getElementById(`message-${msg.id}`);
        if (el) {
          return {
            id: msg.id,
            top: el.offsetTop / scrollHeight
          };
        }
        return null;
      }).filter(Boolean) as { id: string; top: number }[];

      setMessagePositions(positions);
    };

    scrollEl.addEventListener('scroll', handleScroll);
    const observer = new ResizeObserver(updatePositions);
    observer.observe(scrollEl);

    updatePositions();

    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [messages, scrollRef, userMessages]);

  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      setIsOpen(true);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleDrag = (_event: MouseEvent | TouchEvent | PointerEvent, info: { delta: { y: number } }) => {
    isDragging.current = true;
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }

    const { scrollHeight, clientHeight } = scrollEl;
    const totalScrollable = scrollHeight - clientHeight;
    const trackHeight = window.innerHeight - 100;
    const deltaPercent = info.delta.y / trackHeight;
    const newPercent = Math.max(0, Math.min(1, scrollPercentage + deltaPercent));

    setScrollPercentage(newPercent);
    scrollEl.scrollTop = newPercent * totalScrollable;
  };

  return (
    <>
      <div className="fixed right-0 top-0 bottom-0 w-8 z-[100] flex items-center justify-center pointer-events-none">
        <div className="absolute right-3 top-20 bottom-20 w-[1px] bg-white/10" />

        <div className="absolute right-0 top-20 bottom-20 w-8 pointer-events-none">
          {messagePositions.map((pos) => (
            <button
              key={pos.id}
              onClick={() => onJump(pos.id)}
              className="pointer-events-auto absolute right-[9px] w-[6px] h-[12px] bg-white/40 rounded-full hover:bg-white/80 hover:w-[8px] hover:h-[16px] transition-all active:scale-125 cursor-pointer shadow-[0_0_8px_rgba(255,255,255,0.1)]"
              style={{
                top: `${pos.top * 100}%`,
                transform: 'translateY(-50%)'
              }}
              title="Jump to message"
            />
          ))}
        </div>

        <motion.div
          drag="y"
          dragMomentum={false}
          onDrag={handleDrag}
          onDragEnd={() => { isDragging.current = false; }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleTouchStart}
          onMouseUp={handleTouchEnd}
          className="pointer-events-auto absolute right-[9px] w-[6px] h-10 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.3)] cursor-grab active:cursor-grabbing z-10"
          style={{
            top: `calc(80px + ${scrollPercentage * (window.innerHeight - 200)}px)`
          }}
        />
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed right-10 top-0 bottom-0 w-64 bg-black/80 backdrop-blur-2xl border-l border-white/10 z-[110] p-4 flex flex-col"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-white/30 uppercase tracking-widest">Index</h3>
              <button onClick={() => setIsOpen(false)} className="text-white/40">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar">
              {userMessages.length === 0 ? (
                <div className="text-sm text-white/20 text-center py-8 italic">No topics yet</div>
              ) : (
                userMessages.map((msg, idx) => (
                  <button
                    key={msg.id}
                    onClick={() => {
                      onJump(msg.id);
                      setIsOpen(false);
                    }}
                    className="w-full text-left p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-accent/20 hover:border-accent/30 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-[10px] font-mono text-white/20 mt-1">{(idx + 1).toString().padStart(2, '0')}</span>
                      <div className="text-sm text-white/70 line-clamp-2 group-hover:text-white transition-colors">
                        {msg.content || 'Image attachment'}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isOpen && (
        <div
          className="fixed inset-0 z-[105]"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
};
