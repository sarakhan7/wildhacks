"use client";

import React, { useCallback, useState } from "react";
import { UploadCloud, X, FileText, CheckCircle } from "lucide-react";

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  accept?: string;
  className?: string;
}

export function FileUpload({ 
  onFilesSelected, 
  maxFiles = 12, 
  accept = "application/pdf,image/png,image/jpeg",
  className = "" 
}: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files).slice(0, maxFiles - selectedFiles.length);
      if (newFiles.length > 0) {
        const updatedFiles = [...selectedFiles, ...newFiles];
        setSelectedFiles(updatedFiles);
        onFilesSelected(updatedFiles);
      }
    }
  }, [maxFiles, selectedFiles, onFilesSelected]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).slice(0, maxFiles - selectedFiles.length);
      if (newFiles.length > 0) {
        const updatedFiles = [...selectedFiles, ...newFiles];
        setSelectedFiles(updatedFiles);
        onFilesSelected(updatedFiles);
      }
    }
  }, [maxFiles, selectedFiles, onFilesSelected]);

  const removeFile = (idxToRemove: number) => {
    const updated = selectedFiles.filter((_, idx) => idx !== idxToRemove);
    setSelectedFiles(updated);
    onFilesSelected(updated);
  };

  return (
    <div className={`w-full ${className}`}>
      <div 
        className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all 
          ${dragActive ? 'border-[var(--accent-green)] bg-[var(--accent-green-dim)]' : 'border-[var(--border-subtle)] hover:border-[var(--accent-cyan-dim)] hover:bg-[rgba(255,255,255,0.02)]'}
        `}
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
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        
        <div className="bg-[var(--bg-tertiary)] p-4 rounded-full mb-4">
          <UploadCloud className="w-8 h-8 text-[var(--accent-cyan)]" />
        </div>
        <h3 className="text-lg font-medium mb-1">Drag & drop utility bills here</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4 text-center">
          Upload up to 12 months of utility bills (PDFs or images).<br/>
          We support electric and gas bills.
        </p>
        <button className="btn-secondary py-2 text-sm pointer-events-none">
          Browse Files
        </button>
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-[var(--text-secondary)]">
              Selected Files ({selectedFiles.length}/{maxFiles})
            </h4>
            {selectedFiles.length >= 12 && (
              <span className="text-xs text-[var(--accent-green)] flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Full Year Ready
              </span>
            )}
          </div>
          <div className="space-y-2 max-h-[240px] overflow-y-auto pr-2">
            {selectedFiles.map((f, idx) => (
              <div
                key={`${f.name}-${f.lastModified}-${idx}`}
                className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileText className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />
                  <span className="text-sm truncate text-[#e2e8f0]">{f.name}</span>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {(f.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                  <button 
                    onClick={(e) => { e.preventDefault(); removeFile(idx); }}
                    className="p-1 hover:bg-[var(--bg-primary)] rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
