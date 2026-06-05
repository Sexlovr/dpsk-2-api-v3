FROM node:20-bullseye

# Install necessary graphical dependencies, xvfb, x11vnc, novnc, window manager, Chrome, and GIT
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
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Fix noVNC launch script paths
RUN ln -s /usr/share/novnc/vnc_auto.html /usr/share/novnc/index.html || true

# Setup a non-root user (Hugging Face Spaces requirement)
# The node:20 image already has a 'node' user with UID 1000.
USER node
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH

WORKDIR $HOME/app

# Clone your specific repository directly into the container
RUN git clone https://github.com/lolmaobruhhh/dpsk-2-api.git .

# Install dependencies from the cloned repo
RUN npm install

# Fix Windows CRLF line endings on the shell script so bash doesn't crash on boot (Causes 503 errors on Hugging Face otherwise!)
RUN dos2unix start.sh

# Expose ONLY 7860, which Hugging Face expects
EXPOSE 7860

# Give permissions to the start script and run it
RUN chmod +x start.sh
CMD ["./start.sh"]
