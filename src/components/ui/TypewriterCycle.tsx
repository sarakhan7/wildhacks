"use client";

import { useEffect, useMemo, useState } from "react";

interface TypewriterCycleProps {
  values: string[];
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseBeforeDelete?: number;
  pauseBeforeNext?: number;
  className?: string;
}

export function TypewriterCycle({
  values,
  typingSpeed = 70,
  deletingSpeed = 40,
  pauseBeforeDelete = 1100,
  pauseBeforeNext = 250,
  className = "",
}: TypewriterCycleProps) {
  const safeValues = useMemo(() => values.filter(Boolean), [values]);
  const [currentValueIndex, setCurrentValueIndex] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    if (safeValues.length === 0) {
      return;
    }

    const currentValue = safeValues[currentValueIndex % safeValues.length];

    if (!isDeleting && displayText === currentValue) {
      const timeout = window.setTimeout(() => {
        setIsDeleting(true);
      }, pauseBeforeDelete);

      return () => window.clearTimeout(timeout);
    }

    if (isDeleting && displayText.length === 0) {
      const timeout = window.setTimeout(() => {
        setIsDeleting(false);
        setCurrentValueIndex((index) => (index + 1) % safeValues.length);
      }, pauseBeforeNext);

      return () => window.clearTimeout(timeout);
    }

    const nextText = isDeleting
      ? currentValue.slice(0, Math.max(displayText.length - 1, 0))
      : currentValue.slice(0, displayText.length + 1);

    const timeout = window.setTimeout(() => {
      setDisplayText(nextText);
    }, isDeleting ? deletingSpeed : typingSpeed);

    return () => window.clearTimeout(timeout);
  }, [currentValueIndex, deletingSpeed, displayText, isDeleting, pauseBeforeDelete, pauseBeforeNext, safeValues, typingSpeed]);

  useEffect(() => {
    if (safeValues.length === 0) {
      return;
    }

    setCurrentValueIndex(0);
    setDisplayText("");
    setIsDeleting(false);
  }, [safeValues]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCursorVisible((current) => !current);
    }, 520);

    return () => window.clearInterval(interval);
  }, []);

  if (safeValues.length === 0) {
    return null;
  }

  return (
    <span className={className} aria-live="polite" aria-atomic="true">
      {displayText}
      <span className={`inline-block w-[0.65ch] transition-opacity duration-150 ${cursorVisible ? "opacity-100" : "opacity-0"}`}>
        |
      </span>
    </span>
  );
}
