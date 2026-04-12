"use client";

import React, { useCallback, useState } from "react";
import { CheckCircle2, FileText, UploadCloud, X } from "lucide-react";

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  accept?: string;
  className?: string;
}

export function FileUpload({
  onFilesSelected,
  maxFiles = 12,
  accept = "application/pdf,image/png,image/jpeg,image/webp",
  className = "",
}: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(event.type === "dragenter" || event.type === "dragover");
  }, []);

  const updateFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) {
        return;
      }

      const updatedFiles = [...selectedFiles, ...incoming].slice(0, maxFiles);
      setSelectedFiles(updatedFiles);
      onFilesSelected(updatedFiles);
    },
    [maxFiles, onFilesSelected, selectedFiles],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragActive(false);
      updateFiles(Array.from(event.dataTransfer.files));
    },
    [updateFiles],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      updateFiles(Array.from(event.target.files ?? []));
    },
    [updateFiles],
  );

  const removeFile = (indexToRemove: number) => {
    const updatedFiles = selectedFiles.filter((_, index) => index !== indexToRemove);
    setSelectedFiles(updatedFiles);
    onFilesSelected(updatedFiles);
  };

  return (
    <div className={`w-full ${className}`}>
      <div
        className={[
          "relative rounded-[1.7rem] border-2 border-dashed px-8 py-10 text-center transition-colors",
          dragActive
            ? "border-[var(--mid-navy)] bg-white/30"
            : "border-white/60 bg-white/22 hover:border-white/80 hover:bg-white/28",
        ].join(" ")}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept={accept}
          onChange={handleChange}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-white/50 text-mid-navy">
          <UploadCloud className="h-7 w-7" />
        </div>
        <h3 className="font-heading text-[1.2rem] font-bold tracking-[-0.04em] text-navy">Drop utility bills here</h3>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--text-secondary)]">
          Upload up to {maxFiles} PDFs or bill images. Embedded text PDFs are parsed directly, and image bills
          can be read with OCR when configured.
        </p>
        <div className="mt-5 inline-flex rounded-full border border-white/70 bg-white/46 px-5 py-3 text-sm font-medium text-navy">
          Browse files
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-6 rounded-[1.6rem] border border-white/58 bg-white/28 p-5 shadow-[0_6px_24px_rgba(60,100,140,0.08)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-heading text-[1.05rem] font-bold tracking-[-0.04em] text-navy">Files queued</div>
              <div className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {selectedFiles.length} / {maxFiles} uploaded
              </div>
            </div>
            {selectedFiles.length >= 12 && (
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-green-dim)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Full year ready
              </span>
            )}
          </div>

          <div className="space-y-2">
            {selectedFiles.map((file, index) => (
              <div
                key={`${file.name}-${file.lastModified}-${index}`}
                className="flex items-center justify-between gap-4 rounded-[1.1rem] border border-white/60 bg-white/42 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[0.95rem] bg-[var(--accent-blue-dim)] text-mid-navy">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-navy">{file.name}</div>
                    <div className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="rounded-full p-2 text-[var(--text-muted)] transition-colors hover:bg-white/70 hover:text-[var(--accent-red)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
