# Architec

Architec is a next-generation energy audit platform that transforms hours of manual utility bill analysis and building inspections into a 10-minute automated pipeline. By combining high-accuracy OCR with site-specific AI reasoning and interactive 3D visualizations, Architec provides building owners with professional-grade energy insights at zero cost.

## The Product

Traditional commercial energy audits cost between $15,000 and $50,000 and take months to complete. Architec bypasses this overhead by allowing users to simply describe their building and upload 12 months of utility bills. 

### Key Features
- **AI Bill Parsing**: Automatically extracts kWh, therms, peak demand, and costs from PDF and image-based utility bills using Google Gemini 3.0 Flash.
- **Weather-Aware Normalization**: Separates heating, cooling, and baseload consumption using statistical regression and local weather data.
- **3D Digital Twin**: An interactive Mapbox and Three.js visualization that layers solar heatmaps and volumetric thermal plumes onto building models to show energy loss and upgrade potential.
- **AI Analysis Manager**: A conversational voice assistant powered by ElevenLabs that allows owners to explore their audit results and conservation measures through natural dialogue.
- **Prioritized ECMs**: Ranked Energy Conservation Measures (ECMs) with estimated annual savings, simple payback periods, and implementation complexity.

## The Tech Stack

AuditAI was built using a modern, agentic development workflow and high-performance AI services.

### AI & Reasoning
- **Google Gemini 3.0**: Acts as the core intelligence layer for high-accuracy bill OCR and for generating expert-level engineering reports (ASHRAE Level II style).
- **ElevenLabs**: Powers the "AI Analysis Manager" using unbeatable voice quality and low-latency interaction. We used the Conversational AI widget with Dynamic Variables to inject site-specific audit data into the agent's context window.
- **Claude / Claude Code**: Served as our agentic team-programmer for architecting complex Three.js thermal mapping shaders and orchestrating the multi-stage AI pipeline.
- **Appifex AI**: Leveraged for rapid UI and backend prototyping directly from natural language prompts, bypassing manual boilerplate setup.

### Visualization & Spatial Data
- **Mapbox GL & Three.js**: Deliver the 3D building shell and spatial rendering.
- **Google Solar API**: Provides high-fidelity solar radiance data used to generate the precision solar heatmaps on the 3D digital twin.

### Infrastructure
- **Next.js 16 (Turbopack)**: Modern, high-velocity frontend framework.
- **FastAPI (Python)**: High-performance backend for energy analytics and data processing.
- **DigitalOcean App Platform**: Reliable, fast deployment pipeline for both frontend and backend services.

## Getting Started

### Prerequisites
- Node.js (Latest LTS)
- Python 3.11+

### Installation

1. **Clone the repository and install dependencies**:
   ```bash
   npm ci
   python3 -m venv .venv
   .venv/bin/pip install -r backend/requirements.txt
   ```

2. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```bash
   GEMINI_API_KEY=your_key
   ELEVENLABS_AGENT_ID=your_id
   NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_token
   # Add other keys as needed for Solar and NOAA
   ```

3. **Run the Application**:
   Open two terminals from the repository root:

   **Terminal 1 (Backend API):**
   ```bash
   npm run backend:dev
   ```

   **Terminal 2 (Frontend Interface):**
   ```bash
   npm run dev
   ```

4. **Access the App**:
   Visit architec.tech to start your first audit.

---
*Built for WildHacks 2026.*
