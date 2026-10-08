export const vortexVertexShader = /* glsl */ `
  attribute vec4 aSeed;        // x: radiusOffset, y: initialTheta, z: speedMul, w: streamId
  attribute float aType;       // 0.0 to 1.0 random selector

  uniform float uTime;
  uniform float uBuyRatio;     // 0.0 to 1.0
  uniform float uDominance;    // 0.0 (balanced) to 1.0 (extreme)
  uniform float uSpeed;        // 1.0 to 1.8
  uniform float uTilt;         // radians (max 8 degrees = 0.1396)
  uniform float uBreathe;      // 0.95 to 1.05
  uniform float uIntroProgress;// 0.0 to 1.0
  uniform float uPixelRatio;
  uniform float uGlitch;
  uniform float uShockwave;

  uniform vec3 uColorGold;
  uniform vec3 uColorBuy;
  uniform vec3 uColorSell;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float isBuy = step(aType, uBuyRatio);
    float direction = mix(-1.0, 1.0, isBuy); // Buy flows upward (+1), Sell downward (-1)

    // Base shell radius modulated by intro and breathing
    float baseRadius = (2.2 + aSeed.x * 0.9) * uBreathe;
    
    // Intro expansion from dot to full sphere
    float introRadius = mix(0.08, baseRadius, smoothstep(0.0, 1.0, uIntroProgress));

    // Dynamic angle over time
    float angularSpeed = (0.7 + aSeed.z * 0.4) * uSpeed * direction;
    float theta = aSeed.y + uTime * angularSpeed;

    // Spiral latitude flow: Y sweeps between -radius and +radius
    float flowCycle = fract(aSeed.w + uTime * 0.18 * direction * uSpeed);
    float normY = (flowCycle - 0.5) * 2.0; // -1.0 to +1.0
    float y = normY * introRadius * 0.85;

    // Radial waist of the vortex (hourglass / vortex taper in middle)
    float waist = 0.55 + 0.45 * sin(acos(clamp(normY, -0.99, 0.99)));
    float r = sqrt(max(0.01, introRadius * introRadius - y * y)) * waist;

    // Position in XZ plane
    float x = r * cos(theta);
    float z = r * sin(theta);

    // Apply gentle tilt (rotation around Z axis) based on dominant flow
    float tiltAngle = uTilt * smoothstep(0.1, 0.8, uDominance);
    float cosT = cos(tiltAngle);
    float sinT = sin(tiltAngle);
    vec3 tiltedPos = vec3(
      x * cosT - y * sinT,
      x * sinT + y * cosT,
      z
    );

    // Shockwave expansion pulse (Phase 4 signal hook)
    if (uShockwave > 0.0) {
      float waveDist = length(tiltedPos);
      float waveFront = uShockwave * 4.5;
      float diff = abs(waveDist - waveFront);
      if (diff < 0.8) {
        tiltedPos += normalize(tiltedPos) * (0.8 - diff) * 0.8;
      }
    }

    // Glitch jitter (Phase 4 SL hook)
    if (uGlitch > 0.0) {
      float jitter = sin(uTime * 45.0 + aSeed.y * 12.0) * uGlitch * 0.25;
      tiltedPos.x += jitter;
      tiltedPos.z -= jitter;
    }

    // Color derivation:
    // Balanced range (45-55%): buyRatio between 0.45 and 0.55
    float balancedFactor = 1.0 - smoothstep(0.03, 0.18, abs(uBuyRatio - 0.5));
    vec3 dominantFlowColor = mix(uColorSell, uColorBuy, isBuy);
    vec3 finalColor = mix(dominantFlowColor, uColorGold, balancedFactor * 0.92);

    // If intro just starting, show golden core burst
    if (uIntroProgress < 0.3) {
      finalColor = mix(uColorGold * 1.5, finalColor, uIntroProgress / 0.3);
    }

    // SL glitch flashes intense red
    if (uGlitch > 0.0) {
      finalColor = mix(finalColor, uColorSell * 1.4, uGlitch * 0.85);
    }

    vColor = finalColor;
    vAlpha = smoothstep(0.0, 0.15, uIntroProgress) * (0.55 + 0.45 * sin(theta + uTime));

    vec4 mvPosition = modelViewMatrix * vec4(tiltedPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Perspective point attenuation
    float pSize = mix(2.5, 5.0, aSeed.z) * uPixelRatio;
    if (uIntroProgress < 0.4) {
      pSize *= (0.5 + uIntroProgress * 1.5);
    }
    gl_PointSize = pSize * (220.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 32.0);
  }
`;

export const vortexFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Soft point with quadratic radial falloff
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);
    if (distSq > 0.25) discard;

    float radialGlow = smoothstep(0.25, 0.0, distSq);
    float coreSharpness = smoothstep(0.06, 0.0, distSq) * 0.4;
    float intensity = radialGlow + coreSharpness;

    gl_FragColor = vec4(vColor * (intensity * 1.25), vAlpha * radialGlow);
  }
`;
