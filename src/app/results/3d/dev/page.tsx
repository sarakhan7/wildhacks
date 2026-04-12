import { Suspense } from "react";

import VisualizationDevPage from "@/components/visualization/VisualizationDevPage";

export default function Results3DDevPage() {
  return (
    <Suspense fallback={null}>
      <VisualizationDevPage />
    </Suspense>
  );
}
