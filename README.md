# ⚡ SiteCloner — High-Fidelity Website Cloning Engine

SiteCloner is a premium, AI-powered tool designed for developers and designers who need **pixel-perfect, static clones** of modern websites. Unlike traditional "site suckers," SiteCloner uses a headless browser to orchestrate a deep extraction of assets, styles, and interactive state, ensuring that the final output is 100% stable and functionally identical to the original.

![SiteCloner Banner](https://img.shields.io/badge/Status-Premium-brightgreen)
![SiteCloner Banner](https://img.shields.io/badge/AI-Gemini_2.5_Flash-blue)
![SiteCloner Banner](https://img.shields.io/badge/Fidelity-Zero--Loss-orange)

## 🚀 Key Features

*   **Vibe-Powered AI Finishing**: Automatically analyzes clones using **Gemini 2.5 Flash / Vision** to catch and fix hydration errors, broken paths, and visual regressions.
*   **Auto-Scroll Discovery**: Specifically designed to catch **lazy-loaded images** and "reveal" animations by simulating user interaction before capture.
*   **Deep CSS Extraction**: Aggressively captures `@keyframes`, `@font-face`, and complex `@media` queries even from cross-origin protected stylesheets.
*   **Smart URL Rewriting**: Normalizes all root-relative and background-image paths to ensure a 100% portable, offline-first output.
*   **Quick Preview**: Generates a local `run.bat` for every clone for one-click launching.

## 🛠️ Tech Stack

*   **Engine**: Puppeteer (Headless Chrome)
*   **Backend**: Node.js / Express
*   **Intelligence**: Google Gemini 2.5 & DeepSeek V3
*   **Frontend**: Professional Glassmorphic Dashboard

## 🔧 Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/[your-username]/SiteCloner.git
    cd SiteCloner
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure your **`.env`** file:
    ```env
    AI_PROVIDER=gemini
    GEMINI_API_KEY=your_key_here
    GEMINI_MODEL=gemini-2.5-flash
    ```
4.  Launch the app:
    ```bash
    run-sitecloner.bat
    ```

## 💎 Portfolio Project

This tool showcases advanced knowledge of:
- **Headless Browser Orchestration**
- **DOM Serialization & Asset Interception**
- **AI Integration (LLM/Vision)**
- **Modern CSS/JS Extraction**

---
Built with ⚡ by **[Your Name/Username]**
