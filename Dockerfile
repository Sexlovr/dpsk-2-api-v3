FROM node:20-bullseye

# Install necessary graphical dependencies, xvfb, x11vnc, novnc, window manager and GIT
RUN apt-get update && apt-get install -y \
    git \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    dos2unix \
    curl \
    wget \
    gnupg \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Fix noVNC launch script paths
RUN ln -s /usr/share/novnc/vnc_auto.html /usr/share/novnc/index.html || true

# Bypass Hugging Face global cache by polling the latest commit. 
ADD "https://api.github.com/repos/lolmaobruhhh/dpsk-2-api/commits?per_page=1" /tmp/latest_commit

# Clone the repo and install OS dependencies AS ROOT
RUN git clone https://github.com/lolmaobruhhh/dpsk-2-api.git /home/node/app
WORKDIR /home/node/app

RUN npm install
RUN npx playwright install-deps chromium

# Give ownership to the node user
RUN chown -R node:node /home/node/app

# Setup a non-root user (Hugging Face Spaces requirement)
USER node
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH

# Install Chromium binaries AS NODE USER (downloads into ~/.cache/ms-playwright)
RUN npx playwright install chromium

# Fix Windows CRLF line endings on the shell script so bash doesn't crash on boot
RUN dos2unix start.sh

# Expose ONLY 7860, which Hugging Face expects
EXPOSE 7860

# Give permissions to the start script and run it
RUN chmod +x start.sh
CMD ["./start.sh"]

