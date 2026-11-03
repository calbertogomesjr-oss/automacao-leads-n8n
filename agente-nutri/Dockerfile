FROM node:22-bookworm

# JDK 21 (exigido pelo Capacitor 7 / Android Gradle Plugin).
COPY --from=eclipse-temurin:21-jdk /opt/java/openjdk /opt/java/openjdk

ENV JAVA_HOME=/opt/java/openjdk \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Android SDK (só linha de comando).
ARG ANDROID_CMDLINE_TOOLS=11076708
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS}_latest.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/tools.zip \
 && yes | sdkmanager --licenses > /dev/null \
 && sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" > /dev/null \
 && chown -R node:node $ANDROID_HOME

# Agentes de código (o .env escolhe qual usar).
ARG CLAUDE_CODE_VERSION=2.1.317
ARG CODEX_VERSION=0.166.0
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} \
 && npm cache clean --force

# Pastas persistentes (volumes) precisam ser do usuário node.
RUN mkdir -p /dados /home/node/.android /home/node/.gradle /home/node/.claude /home/node/.codex \
 && chown -R node:node /dados /home/node

WORKDIR /app
COPY --chown=node:node builder/ /app/
COPY --chown=node:node template/ /app/template/

# O Claude Code não aceita pular permissões como root; o container já é o isolamento.
USER node
EXPOSE 3100
CMD ["node", "server.mjs"]
