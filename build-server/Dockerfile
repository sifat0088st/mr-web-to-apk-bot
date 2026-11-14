FROM eclipse-temurin:17-jdk-jammy

ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV GRADLE_HOME=/opt/gradle
ENV PATH="${GRADLE_HOME}/bin:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/build-tools/34.0.0:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip ca-certificates zipalign \
    && rm -rf /var/lib/apt/lists/*

# Install Gradle 8.9
RUN curl -fsSL https://services.gradle.org/distributions/gradle-8.9-bin.zip -o /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && mv /opt/gradle-8.9 /opt/gradle \
    && rm -f /tmp/gradle.zip

# Install Android SDK Command-line Tools, platform-tools, build-tools 34.0.0, and android-34
RUN mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools \
    && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/cmdline.zip \
    && unzip -q /tmp/cmdline.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools \
    && mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest \
    && rm -f /tmp/cmdline.zip \
    && yes | sdkmanager --licenses > /dev/null \
    && sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# Pre-warm Gradle dependencies cache inside image so isolated --network=none builds work cleanly
WORKDIR /opt/warmup
COPY android-webview-template/ /opt/warmup/
RUN gradle assembleRelease --no-daemon || true && rm -rf /opt/warmup

RUN useradd -m -u 10001 builder
USER builder
WORKDIR /workspace

CMD ["gradle", "assembleRelease", "--offline", "--no-daemon"]
