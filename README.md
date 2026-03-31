# ⚡ SiteCloner — High-Fidelity Website Cloning Engine
### Developed by **mustadafinshimanto**

SiteCloner is a premium, AI-powered tool architected by **mustadafinshimanto** for developers and designers who need **high-fidelity clones** of modern websites. While achieving 100% pixel-perfection on framework-heavy sites is an industry-wide challenge, the SiteCloner engine uses a next-gen headless system and AI vision to achieve **70-80% visual and functional fidelity out of the box.**

![SiteCloner Banner](https://img.shields.io/badge/Status-Premium-brightgreen)
![SiteCloner Banner](https://img.shields.io/badge/AI-Active_Fidelity_Healing-blue)
![SiteCloner Banner](https://img.shields.io/badge/Architect-mustadafinshimanto-orange)

## 🚀 Key Features

*   **Fidelity Healing Engine**: Architected to bridge the gap from 70% to 100% by identifying and patching visual regressions using **Gemini 2.5 Vision**.
*   **Intelligent UI Cleanup**: Automatically removes blocking, broken elements like Disclaimer banners and Cookie modals using the **V6 Ultra** "Janitor" logic.
*   **Auto-Scroll Discovery**: Dramatically improves image capture by simulating user interaction to trigger lazy-loaded assets before serialization.
*   **Deep CSS Extraction**: Aggressively captures keyframes and font-faces, optimized for modern framework-heavy sites.
*   **Quick Preview**: Generates a local `run.bat` for every clone for one-click launching.

## 🛠️ Tech Stack

*   **Architected by**: mustadafinshimanto
*   **Engine**: Puppeteer (Headless Chrome)
*   **Backend**: Node.js / Express
*   **Intelligence**: Google Gemini 2.5 & DeepSeek V3
*   **Frontend**: Professional Glassmorphic Dashboard

## 🔧 Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/mustadafinshimanto/SiteCloner-v1.5.git
    cd SiteCloner
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure your **`.env`** file:
    -   Copy the template: `cp .env.example .env`
    -   Add your **Gemini API Key** to the newly created `.env` file!
    ```env
    AI_PROVIDER=gemini
    GEMINI_API_KEY=your_key_here
    GEMINI_MODEL=gemini-2.5-flash
    ```
4.  Launch the app:
    ```bash
    run-sitecloner.bat
    ```

---
Built with ⚡ by **mustadafinshimanto**  
*Lead Developer & Architect of the SiteCloner Engine*
