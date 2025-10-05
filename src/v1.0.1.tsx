import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';

// Utility: Hash string to hue (0-360) with better distribution
const hashToHue = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Use golden ratio to distribute hues more evenly across spectrum
  const goldenRatio = 0.618033988749895;
  return Math.abs((hash * goldenRatio) % 1) * 360;
};

// Utility: Parse scope to size
const scopeToSize = (scopeText) => {
  if (!scopeText) return 150;
  const lower = scopeText.toLowerCase();
  if (lower.includes('international') || lower.includes('global')) return 300;
  if (lower.includes('national')) return 250;
  if (lower.includes('regional') || lower.includes('state')) return 200;
  if (lower.includes('local') || lower.includes('community')) return 150;
  if (lower.includes('family') || lower.includes('personal')) return 100;
  return 120;
};

// Utility: Detect practice frequencies
const detectFrequencies = (practicesText) => {
  if (!practicesText) return [2000];
  const lower = practicesText.toLowerCase();
  const frequencies = [];
  
  if (lower.includes('daily') || lower.includes('every day')) frequencies.push(500);
  if (lower.includes('weekly') || lower.includes('every week')) frequencies.push(1500);
  if (lower.includes('monthly') || lower.includes('every month')) frequencies.push(3000);
  if (lower.includes('annual') || lower.includes('yearly') || lower.includes('every year')) frequencies.push(6000);
  
  return frequencies.length > 0 ? frequencies : [2000];
};

const KinshipVisualization = () => {
  const [cultures, setCultures] = useState([]);
  const [selectedCulture, setSelectedCulture] = useState(null);
  const [hoveredCulture, setHoveredCulture] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const particlesRef = useRef([]);
  const culturesDataRef = useRef([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const fadeOverlayRef = useRef(0);
  const targetFadeRef = useRef(0);
  const hoveredCultureRef = useRef(null);

  // Virtual world dimensions
  const WORLD_WIDTH = 12000;
  const WORLD_HEIGHT = 9000;

  // Clean culture name to 1-3 keywords
  const cleanCultureName = (name) => {
    if (!name) return 'Unknown';
    
    const stopWords = ['the', 'of', 'and', 'a', 'an', 'in', 'to', 'for', 'culture', 
                       'community', 'people', 'group', 'my', 'our', 'society', 'submission'];
    
    const words = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));
    
    const cleaned = words
      .slice(0, 3)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    
    return cleaned || 'Culture';
  };

  // Merge similar cultures
  const mergeCultures = (cultures) => {
    const merged = new Map();
    
    cultures.forEach(culture => {
      const key = culture.name.toLowerCase().trim();
      
      if (merged.has(key)) {
        const existing = merged.get(key);
        existing.values = [...new Set([...existing.values, ...culture.values])];
        existing.colors = existing.values.map(v => `hsl(${hashToHue(v)}, 70%, 60%)`);
        existing.kinships = [...new Set([...existing.kinships, ...culture.kinships])];
        existing.knowledgebase = Math.round((existing.knowledgebase + culture.knowledgebase) / 2);
        existing.openness = Math.round((existing.openness + culture.openness) / 2);
        existing.size = Math.max(existing.size, culture.size);
        existing.frequencies = [...new Set([...existing.frequencies, ...culture.frequencies])];
      } else {
        merged.set(key, { ...culture });
      }
    });
    
    // Return merged cultures with new IDs (sides will be calculated later)
    return Array.from(merged.values()).map((c, idx) => ({ ...c, id: idx }));
  };

  // File upload handler
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        processCultures(results.data);
      }
    });
  };

  // Process CSV data with random non-overlapping placement
  const processCultures = (data) => {
    const processed = [];
    const placedCultures = [];
    
    data.forEach((row, index) => {
      const rawName = Object.values(row)[1] || `Culture ${index + 1}`;
      const cultureName = cleanCultureName(rawName);
      const valuesText = Object.values(row)[2] || '';
      const kinshipsText = Object.values(row)[4] || '';
      const knowledgebase = parseInt(Object.values(row)[5]) || 5;
      const openness = parseInt(Object.values(row)[6]) || 5;
      const scopeText = Object.values(row)[8] || '';
      const practicesText = Object.values(row)[9] || '';
      
      const values = valuesText.split(',').map(v => v.trim()).filter(v => v);
      const colors = values.map(v => `hsl(${hashToHue(v)}, 70%, 60%)`);
      
      const kinships = kinshipsText
        .split(',')
        .map(k => cleanCultureName(k.trim()))
        .filter(k => k && k !== 'Culture');
      
      const frequencies = detectFrequencies(practicesText);
      const size = scopeToSize(scopeText);
      
      // Find a random position that doesn't overlap with existing cultures
      let x, y, attempts = 0;
      let validPosition = false;
      const maxAttempts = 100;
      const padding = 500;
      
      while (!validPosition && attempts < maxAttempts) {
        x = Math.random() * (WORLD_WIDTH - 2000) + 1000;
        y = Math.random() * (WORLD_HEIGHT - 2000) + 1000;
        
        validPosition = true;
        for (let placed of placedCultures) {
          const dx = x - placed.x;
          const dy = y - placed.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = (size + placed.size) / 2 + padding;
          
          if (dist < minDist) {
            validPosition = false;
            break;
          }
        }
        
        attempts++;
      }
      
      const culture = {
        id: index,
        name: cultureName,
        values,
        colors,
        kinships,
        sides: 3, // Will be calculated after all cultures are loaded
        knowledgebase,
        openness,
        size,
        frequencies,
        x,
        y,
        homeX: x,
        homeY: y,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        targetX: null,
        targetY: null,
        scale: 1,
        targetScale: 1,
        opacity: 0.5,
        targetOpacity: 0.5,
        rotation: Math.random() * Math.PI * 2,
        morphOffset: 0,
        layer: 0
      };
      
      placedCultures.push(culture);
      processed.push(culture);
    });

    const mergedCultures = mergeCultures(processed);
    
    // NOW calculate sides based on ACTUAL found connections
    mergedCultures.forEach(culture => {
      let connectedCount = 0;
      
      mergedCultures.forEach(otherCulture => {
        if (culture.id === otherCulture.id) return;
        
        const isKin = culture.kinships.some(k => 
          otherCulture.name.toLowerCase().includes(k.toLowerCase()) || 
          k.toLowerCase().includes(otherCulture.name.toLowerCase())
        );
        
        if (isKin) connectedCount++;
      });
      
      // Sides = actual number of found connections (minimum 3 for triangle)
      culture.sides = Math.max(3, connectedCount);
    });
    
    culturesDataRef.current = mergedCultures;
    setCultures(mergedCultures);
    initializeParticles(mergedCultures);
    
    // Center camera on random culture after canvas is ready
    setTimeout(() => {
      if (mergedCultures.length > 0) {
        const randomCulture = mergedCultures[Math.floor(Math.random() * mergedCultures.length)];
        
        const canvas = canvasRef.current;
        if (canvas && canvas.width > 0) {
          cameraRef.current = {
            x: randomCulture.x - canvas.width / 2,
            y: randomCulture.y - canvas.height / 2,
            zoom: 1
          };
          setCamera({ ...cameraRef.current });
        }
      }
    }, 100);
  };

  // Initialize particles
  const initializeParticles = (culturesData) => {
    const newParticles = [];
    
    culturesData.forEach((culture, cultureIndex) => {
      // Particle count directly proportional to trait/value count
      const particleCount = Math.max(5, culture.values.length * 5);
      
      // Use golden angle to distribute hues evenly across ALL cultures
      // This ensures maximum color separation between cultures
      const goldenAngle = 137.508; // Golden angle in degrees
      const unifiedHue = (cultureIndex * goldenAngle) % 360;
      
      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (culture.size / 2 - 15);
        
        // Very high saturation for vibrant, distinct colors
        const saturation = 80 + Math.random() * 15; // 80-95%
        const lightness = 55 + Math.random() * 10; // 55-65%
        
        newParticles.push({
          cultureId: culture.id,
          homeCultureId: culture.id,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          color: `hsl(${unifiedHue}, ${saturation}%, ${lightness}%)`,
          size: 2 + Math.random() * 2,
          wavePhase: Math.random() * Math.PI * 2,
          state: 'contained',
          targetCultureId: null,
          flowPartner: null,
          flowProgress: 0,
          baseSpeed: 0.3 + Math.random() * 0.3,
          activationDelay: 0,
          activationStartTime: 0
        });
      }
    });
    
    particlesRef.current = newParticles;
  };

  // Randomize all culture positions - COMPLETE RESET
  const randomizeCulturePositions = (focusCultureId = null) => {
    const newCultures = [];
    
    culturesDataRef.current.forEach((culture) => {
      let x, y, attempts = 0;
      let validPosition = false;
      const maxAttempts = 100;
      const padding = 500;
      
      while (!validPosition && attempts < maxAttempts) {
        x = Math.random() * (WORLD_WIDTH - 2000) + 1000;
        y = Math.random() * (WORLD_HEIGHT - 2000) + 1000;
        
        validPosition = true;
        for (let placed of newCultures) {
          const dx = x - placed.x;
          const dy = y - placed.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = (culture.size + placed.size) / 2 + padding;
          
          if (dist < minDist) {
            validPosition = false;
            break;
          }
        }
        attempts++;
      }
      
      newCultures.push({
        ...culture,
        x: x,
        y: y,
        homeX: x,
        homeY: y,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        targetX: null,
        targetY: null,
        scale: 1,
        targetScale: 1,
        opacity: 0.5,
        targetOpacity: 0.5,
        layer: 0,
        morphOffset: 0
      });
    });
    
    culturesDataRef.current = newCultures;
    initializeParticles(newCultures);
    
    // Center camera on specific culture or random one
    if (newCultures.length > 0) {
      let targetCulture;
      
      if (focusCultureId !== null) {
        // Find the culture that was focused
        targetCulture = newCultures.find(c => c.id === focusCultureId);
      }
      
      // Fallback to random if not found
      if (!targetCulture) {
        targetCulture = newCultures[Math.floor(Math.random() * newCultures.length)];
      }
      
      const canvas = canvasRef.current;
      if (canvas) {
        cameraRef.current = {
          x: targetCulture.x - canvas.width / 2,
          y: targetCulture.y - canvas.height / 2,
          zoom: 1
        };
        setCamera({ ...cameraRef.current });
      }
    }
    
    setCultures([...newCultures]);
  };

  // Exit focus mode handler with smooth fade transition
  const handleExitFocus = () => {
    if (isExiting) return; // Prevent double-click
    
    setIsExiting(true);
    
    const focusedCultureId = selectedCulture?.id;
    
    // Step 1: Smoothly return all cultures to normal state
    culturesDataRef.current = culturesDataRef.current.map(c => ({
      ...c,
      targetX: null,
      targetY: null,
      targetScale: 1,
      targetOpacity: 0.5,
      layer: 0
    }));
    setCultures([...culturesDataRef.current]);
    
    // Step 2: Tell particles to return home
    deactivateParticleFlow();
    
    // Step 3: After 1 second, start fading out
    setTimeout(() => {
      targetFadeRef.current = 1; // Trigger fade to black
    }, 1000);
    
    // Step 4: At peak fade (1.5s), randomize positions (hidden)
    setTimeout(() => {
      setSelectedCulture(null);
      randomizeCulturePositions(focusedCultureId);
    }, 1500);
    
    // Step 5: After randomization, fade back in (2s)
    setTimeout(() => {
      targetFadeRef.current = 0; // Trigger fade from black
    }, 2000);
    
    // Step 6: Clear exiting state after fade-in completes (2.5s)
    setTimeout(() => {
      setIsExiting(false);
    }, 2500);
  };

  // Handle culture click
  const handleCultureClick = (culture) => {
    if (isTransitioning) return;
    
    setIsTransitioning(true);
    setSelectedCulture(culture);
    
    const canvas = canvasRef.current;
    const centerX = culture.x;
    const centerY = culture.y;
    
    cameraRef.current = {
      x: centerX - canvas.width / 2,
      y: centerY - canvas.height / 2,
      zoom: 1
    };
    setCamera({ ...cameraRef.current });
    
    // Find connected cultures
    const connectedCultures = [];
    culturesDataRef.current.forEach(c => {
      if (c.id === culture.id) return;
      
      const isKin = culture.kinships.some(k => 
        c.name.toLowerCase().includes(k.toLowerCase()) || 
        k.toLowerCase().includes(c.name.toLowerCase())
      );
      
      if (isKin) connectedCultures.push(c);
    });
    
    // Update positions with edge-aligned layout
    culturesDataRef.current = culturesDataRef.current.map(c => {
      if (c.id === culture.id) {
        return {
          ...c,
          targetX: centerX,
          targetY: centerY,
          targetScale: 2,
          targetOpacity: 1,
          layer: 3
        };
      } else {
        const kinIndex = connectedCultures.findIndex(kin => kin.id === c.id);
        
        if (kinIndex !== -1) {
          // Calculate edge-aligned position with PARALLEL edges
          const edgeIndex = kinIndex;
          const totalEdges = culture.sides;
          
          // Get the midpoint angle of this edge on the focused polygon
          const edgeMidAngle = culture.rotation + (Math.PI * 2 * (edgeIndex + 0.5)) / totalEdges;
          
          // Position the connected culture along the outward normal
          const focusedRadius = (culture.size * 2) / 2;
          const connectedRadius = (c.size * 1.2) / 2;
          const spacing = 80;
          const distance = focusedRadius + connectedRadius + spacing;
          
          const targetX = centerX + Math.cos(edgeMidAngle) * distance;
          const targetY = centerY + Math.sin(edgeMidAngle) * distance;
          
          // ROTATE the connected culture so one of its edges is PARALLEL to the focused edge
          // The focused edge is perpendicular to edgeMidAngle (the normal)
          // So the focused edge direction is: edgeMidAngle + π/2
          const focusedEdgeDirection = edgeMidAngle + Math.PI / 2;
          
          // We want the connected culture's edge to be parallel but facing opposite
          // So the connected edge should be at angle: focusedEdgeDirection + π
          const targetEdgeDirection = focusedEdgeDirection + Math.PI;
          
          // For the connected polygon, we want one edge (let's say edge 0) to point in targetEdgeDirection
          // Edge 0 midpoint is at rotation + (π * 2 * 0.5) / c.sides = rotation + π / c.sides
          // Edge direction is perpendicular to the normal: (rotation + π / c.sides) + π/2
          // We want: rotation + π / c.sides + π/2 = targetEdgeDirection
          // So: rotation = targetEdgeDirection - π/2 - π / c.sides
          
          const targetRotation = targetEdgeDirection - Math.PI / 2 - Math.PI / c.sides;
          
          return {
            ...c,
            targetX: targetX,
            targetY: targetY,
            rotation: targetRotation, // Set the rotation to align edges
            targetScale: 1.2,
            targetOpacity: 0.8,
            layer: 2
          };
        } else {
          return {
            ...c,
            targetScale: 0.4,
            targetOpacity: 0.1,
            layer: 0
          };
        }
      }
    });
    
    setCultures([...culturesDataRef.current]);
    
    // Activate particle flow in focus mode
    activateParticleFlow(culture.id, connectedCultures.map(c => c.id));
    
    setTimeout(() => {
      setIsTransitioning(false);
    }, 800);
  };

  // Activate particle flow between focused culture and connected cultures
  const activateParticleFlow = (focusedId, connectedIds) => {
    particlesRef.current = particlesRef.current.map(particle => {
      const isInFocused = particle.homeCultureId === focusedId;
      const isInConnected = connectedIds.includes(particle.homeCultureId);
      
      // 50% of particles from focused culture will eventually flow
      if (isInFocused && Math.random() < 0.5 && connectedIds.length > 0) {
        const targetId = connectedIds[Math.floor(Math.random() * connectedIds.length)];
        return {
          ...particle,
          state: 'activating', // New state for gradual diffusion
          targetCultureId: targetId,
          flowPartner: focusedId,
          flowProgress: 0,
          activationDelay: Math.random() * 2000, // 0-2 seconds staggered start
          activationStartTime: Date.now(),
          baseSpeed: 0.3 + Math.random() * 0.3
        };
      }
      
      // 40% of particles from connected cultures will eventually flow
      if (isInConnected && Math.random() < 0.4) {
        return {
          ...particle,
          state: 'activating',
          targetCultureId: focusedId,
          flowPartner: particle.homeCultureId,
          flowProgress: 0,
          activationDelay: Math.random() * 2000,
          activationStartTime: Date.now(),
          baseSpeed: 0.3 + Math.random() * 0.3
        };
      }
      
      return particle;
    });
  };

  // Deactivate particle flow (return all to contained state)
  const deactivateParticleFlow = () => {
    particlesRef.current = particlesRef.current.map(particle => {
      // If still activating, just return to contained immediately
      if (particle.state === 'activating') {
        return {
          ...particle,
          state: 'contained',
          targetCultureId: null,
          flowPartner: null,
          activationDelay: 0,
          activationStartTime: 0
        };
      }
      // If already flowing, need to return home
      return {
        ...particle,
        state: 'returning',
        targetCultureId: particle.homeCultureId,
        flowPartner: null
      };
    });
  };

  // Apply force-directed layout - NO COLLISION
  const applyForces = () => {
    const attraction = 0.00001;
    const damping = 0.96;
    const brownianForce = 0.08;
    const homeSpringStrength = 0.003;
    const homeRadius = 300;
    const velocityThreshold = 0.02;
    const forceThreshold = 0.01;
    
    culturesDataRef.current.forEach((c1) => {
      if (c1.targetX !== null) return;
      
      let fx = 0, fy = 0;
      
      const currentVel = Math.sqrt(c1.vx ** 2 + c1.vy ** 2);
      if (currentVel > velocityThreshold) {
        fx += (Math.random() - 0.5) * brownianForce;
        fy += (Math.random() - 0.5) * brownianForce;
      }
      
      const dxHome = c1.homeX - c1.x;
      const dyHome = c1.homeY - c1.y;
      const distFromHome = Math.sqrt(dxHome * dxHome + dyHome * dyHome);
      
      if (distFromHome > homeRadius) {
        const pullStrength = (distFromHome - homeRadius) * homeSpringStrength;
        fx += dxHome * pullStrength;
        fy += dyHome * pullStrength;
      } else if (distFromHome > 10) {
        fx += dxHome * homeSpringStrength * 0.3;
        fy += dyHome * homeSpringStrength * 0.3;
      }
      
      const centerX = WORLD_WIDTH / 2;
      const centerY = WORLD_HEIGHT / 2;
      const toCenterX = centerX - c1.x;
      const toCenterY = centerY - c1.y;
      fx += toCenterX * attraction;
      fy += toCenterY * attraction;
      
      const totalForce = Math.sqrt(fx ** 2 + fy ** 2);
      if (totalForce < forceThreshold) {
        fx = 0;
        fy = 0;
      }
      
      c1.vx = (c1.vx + fx) * damping;
      c1.vy = (c1.vy + fy) * damping;
      
      if (Math.abs(c1.vx) < velocityThreshold && Math.abs(c1.vy) < velocityThreshold) {
        c1.vx = 0;
        c1.vy = 0;
      }
      
      const maxVel = 0.8;
      const vel = Math.sqrt(c1.vx ** 2 + c1.vy ** 2);
      if (vel > maxVel) {
        c1.vx = (c1.vx / vel) * maxVel;
        c1.vy = (c1.vy / vel) * maxVel;
      }
      
      c1.x += c1.vx;
      c1.y += c1.vy;
      
      const margin = 800;
      c1.x = Math.max(margin, Math.min(WORLD_WIDTH - margin, c1.x));
      c1.y = Math.max(margin, Math.min(WORLD_HEIGHT - margin, c1.y));
    });
  };

  // Draw polygon
  const drawPolygon = (ctx, culture, time) => {
    const { x, y, sides, size, scale, knowledgebase, openness, rotation, morphOffset, opacity } = culture;
    
    // Boost opacity to 100% if hovered (same as focused mode)
    const renderOpacity = (hoveredCultureRef.current && hoveredCultureRef.current.id === culture.id) ? 1.0 : opacity;
    
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation + morphOffset);
    ctx.globalAlpha = renderOpacity;
    
    const shouldMorph = knowledgebase <= 6;
    const morphAmount = shouldMorph ? Math.sin(time * 0.001) * 0.1 : 0;
    
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (Math.PI * 2 * i) / sides;
      const radius = (size * scale) / 2;
      const r = radius * (1 + morphAmount * Math.sin(i * 0.5));
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    
    if (openness >= 7) {
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.5;
    } else if (openness >= 4) {
      ctx.setLineDash([8, 4]);
      ctx.lineWidth = 2;
    } else {
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
    }
    
    ctx.strokeStyle = renderOpacity > 0.5 ? 'rgba(220, 220, 220, 0.95)' : 'rgba(180, 180, 180, 0.7)';
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.restore();
  };

  // Enforce hard polygon boundary - push particle inside and bounce
  const enforcePolygonBoundary = (particle, culture) => {
    const radius = (culture.size * culture.scale) / 2;
    const angleStep = (Math.PI * 2) / culture.sides;
    const apothem = radius * Math.cos(Math.PI / culture.sides);
    const rotation = culture.rotation + culture.morphOffset;
    
    // Check each edge and enforce boundary
    for (let i = 0; i < culture.sides; i++) {
      // Edge midpoint angle (this is where the normal points outward from)
      const edgeMidAngle = rotation + angleStep * (i + 0.5);
      const normalAngle = edgeMidAngle; // Normal points outward from center through edge midpoint
      
      // Distance from particle to edge along normal
      const distToEdge = particle.x * Math.cos(normalAngle) + particle.y * Math.sin(normalAngle);
      const boundary = apothem - 10;
      
      if (distToEdge > boundary) {
        // Push particle back inside
        const overflow = distToEdge - boundary;
        particle.x -= Math.cos(normalAngle) * overflow;
        particle.y -= Math.sin(normalAngle) * overflow;
        
        // Bounce: reflect velocity across edge normal
        const normalVel = particle.vx * Math.cos(normalAngle) + particle.vy * Math.sin(normalAngle);
        if (normalVel > 0) {
          particle.vx -= 2 * normalVel * Math.cos(normalAngle) * 0.6;
          particle.vy -= 2 * normalVel * Math.sin(normalAngle) * 0.6;
        }
      }
    }
  };

  // Draw particles
  const drawParticles = (ctx, time) => {
    particlesRef.current.forEach(particle => {
      const culture = culturesDataRef.current.find(c => c.id === particle.cultureId);
      if (!culture || culture.opacity < 0.15) return;
      
      // Boost opacity to 100% if hovered (same as focused mode)
      const renderOpacity = (hoveredCultureRef.current && hoveredCultureRef.current.id === culture.id) ? 1.0 : culture.opacity;
      
      // Handle different particle states
      if (particle.state === 'contained') {
        // Original contained behavior
        let waveOffset = 0;
        culture.frequencies.forEach((freq) => {
          const phase = (time / freq) * Math.PI * 2 + particle.wavePhase;
          waveOffset += Math.sin(phase) * 5;
        });
        
        particle.x += particle.vx;
        particle.y += particle.vy;
        
        // Enforce hard polygon boundary
        enforcePolygonBoundary(particle, culture);
        
        const worldX = culture.x + particle.x + waveOffset * 0.3;
        const worldY = culture.y + particle.y + waveOffset * 0.3;
        
        ctx.globalAlpha = renderOpacity * 0.95;
        ctx.beginPath();
        ctx.arc(worldX, worldY, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        
      } else if (particle.state === 'activating') {
        // Gradual transition from contained to flowing
        const elapsedTime = Date.now() - particle.activationStartTime;
        
        if (elapsedTime < particle.activationDelay) {
          // Still waiting - behave as contained
          let waveOffset = 0;
          culture.frequencies.forEach((freq) => {
            const phase = (time / freq) * Math.PI * 2 + particle.wavePhase;
            waveOffset += Math.sin(phase) * 5;
          });
          
          particle.x += particle.vx;
          particle.y += particle.vy;
          
          // Enforce hard polygon boundary
          enforcePolygonBoundary(particle, culture);
          
          const worldX = culture.x + particle.x + waveOffset * 0.3;
          const worldY = culture.y + particle.y + waveOffset * 0.3;
          
          ctx.globalAlpha = renderOpacity * 0.95;
          ctx.beginPath();
          ctx.arc(worldX, worldY, particle.size, 0, Math.PI * 2);
          ctx.fillStyle = particle.color;
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          // Activation period - gradually transition to flowing
          const transitionDuration = 1000; // 1 second transition
          const transitionProgress = Math.min(1, (elapsedTime - particle.activationDelay) / transitionDuration);
          
          if (transitionProgress >= 1) {
            // Fully activated - switch to flowing state
            particle.state = 'flowing';
          }
          
          // Blend between contained and flowing behavior
          const targetCulture = culturesDataRef.current.find(c => c.id === particle.targetCultureId);
          if (!targetCulture) return;
          
          // Get world position
          const worldX = culture.x + particle.x;
          const worldY = culture.y + particle.y;
          
          // Calculate direction to target
          const dx = targetCulture.x - worldX;
          const dy = targetCulture.y - worldY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > 0) {
            const dirX = dx / distance;
            const dirY = dy / distance;
            
            // Gradually increase outward force
            const outwardForce = 0.01 * transitionProgress;
            particle.vx += dirX * outwardForce;
            particle.vy += dirY * outwardForce;
            
            // Gradually reduce containment
            const containmentStrength = 1 - transitionProgress;
            const dist = Math.sqrt(particle.x ** 2 + particle.y ** 2);
            const maxDist = (culture.size * culture.scale) / 2 - 12;
            
            if (dist > maxDist && containmentStrength > 0) {
              const angle = Math.atan2(particle.y, particle.x);
              const pullBack = (dist - maxDist) * containmentStrength * 0.1;
              particle.vx -= Math.cos(angle) * pullBack;
              particle.vy -= Math.sin(angle) * pullBack;
            }
          }
          
          // Update position
          particle.x += particle.vx;
          particle.y += particle.vy;
          
          // Draw
          const newWorldX = culture.x + particle.x;
          const newWorldY = culture.y + particle.y;
          
          ctx.globalAlpha = renderOpacity * 0.95;
          ctx.beginPath();
          ctx.arc(newWorldX, newWorldY, particle.size, 0, Math.PI * 2);
          ctx.fillStyle = particle.color;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        
      } else if (particle.state === 'flowing' || particle.state === 'returning') {
        // Flowing behavior - realistic diffusion and dispersion
        const targetCulture = culturesDataRef.current.find(c => c.id === particle.targetCultureId);
        if (!targetCulture) return;
        
        // Current world position
        const worldX = culture.x + particle.x;
        const worldY = culture.y + particle.y;
        
        // Target position - aim for edge closest to us, not center
        const targetWorldX = targetCulture.x;
        const targetWorldY = targetCulture.y;
        
        // Calculate direction to target
        const dx = targetWorldX - worldX;
        const dy = targetWorldY - worldY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Arrival threshold based on target culture size
        const arrivalDistance = (targetCulture.size * targetCulture.scale) / 2 - 30;
        
        if (distance > arrivalDistance) {
          // Still traveling - apply realistic physics
          const dirX = dx / distance;
          const dirY = dy / distance;
          
          // MUCH SLOWER and more realistic parameters
          const maxSpeed = (particle.baseSpeed || 0.4) * 0.6; // 40% slower
          const steeringForce = 0.003; // Even gentler for slower acceleration
          const damping = 0.992; // Slightly less damping so particles maintain momentum
          
          // Apply steering force
          particle.vx += dirX * steeringForce;
          particle.vy += dirY * steeringForce;
          
          // Add PERPENDICULAR dispersion for wider paths (like real diffusion)
          const perpX = -dirY; // Perpendicular to flow direction
          const perpY = dirX;
          const dispersionStrength = 0.08; // Much stronger for very wide paths
          particle.vx += perpX * (Math.random() - 0.5) * dispersionStrength;
          particle.vy += perpY * (Math.random() - 0.5) * dispersionStrength;
          
          // Add longitudinal turbulence (along flow direction)
          const turbulence = 0.025; // Increased for more organic spread
          particle.vx += (Math.random() - 0.5) * turbulence;
          particle.vy += (Math.random() - 0.5) * turbulence;
          
          // Apply damping
          particle.vx *= damping;
          particle.vy *= damping;
          
          // Limit speed
          const speed = Math.sqrt(particle.vx ** 2 + particle.vy ** 2);
          if (speed > maxSpeed) {
            particle.vx = (particle.vx / speed) * maxSpeed;
            particle.vy = (particle.vy / speed) * maxSpeed;
          }
          
          // Update position in world space, then convert to local
          const newWorldX = worldX + particle.vx;
          const newWorldY = worldY + particle.vy;
          particle.x = newWorldX - culture.x;
          particle.y = newWorldY - culture.y;
          
          // Draw at current world position
          ctx.globalAlpha = renderOpacity * 0.95;
          ctx.beginPath();
          ctx.arc(newWorldX, newWorldY, particle.size, 0, Math.PI * 2);
          ctx.fillStyle = particle.color;
          ctx.fill();
          ctx.globalAlpha = 1;
          
        } else {
          // Arrived at target culture - CONTINUOUS FLOW
          if (particle.state === 'flowing') {
            // Transfer to target culture's reference frame
            particle.cultureId = particle.targetCultureId;
            
            // Keep current world position but convert to new culture's local coords
            particle.x = worldX - targetCulture.x;
            particle.y = worldY - targetCulture.y;
            
            // Reduce velocity slightly for smooth flow continuation
            particle.vx *= 0.7;
            particle.vy *= 0.7;
            
            // CONTINUOUS EXCHANGE: Reverse flow direction
            const temp = particle.targetCultureId;
            particle.targetCultureId = particle.flowPartner;
            particle.flowPartner = temp;
            // Stay in 'flowing' state for endless cycling
            
          } else if (particle.state === 'returning') {
            // Returned home, become contained
            particle.cultureId = particle.homeCultureId;
            
            // Settle into contained motion within home culture
            const angle = Math.atan2(particle.y, particle.x);
            const currentDist = Math.sqrt(particle.x ** 2 + particle.y ** 2);
            const maxDist = (targetCulture.size * targetCulture.scale) / 2 - 15;
            
            if (currentDist > maxDist) {
              particle.x = Math.cos(angle) * maxDist;
              particle.y = Math.sin(angle) * maxDist;
            }
            
            particle.vx = (Math.random() - 0.5) * 0.3;
            particle.vy = (Math.random() - 0.5) * 0.3;
            particle.state = 'contained';
            particle.targetCultureId = null;
            particle.baseSpeed = undefined;
          }
        }
      }
    });
  };

  // Animation loop
  useEffect(() => {
    if (cultures.length === 0) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    let startTime = Date.now();
    
    const animate = () => {
      const time = Date.now() - startTime;
      
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.save();
      ctx.translate(-cameraRef.current.x, -cameraRef.current.y);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);
      
      if (!selectedCulture && !isExiting) {
        applyForces();
      }
      
      // Smoothly interpolate fade overlay
      fadeOverlayRef.current += (targetFadeRef.current - fadeOverlayRef.current) * 0.15;
      
      culturesDataRef.current = culturesDataRef.current.map(c => {
        let newX = c.x;
        let newY = c.y;
        let newScale = c.scale;
        let newOpacity = c.opacity;
        
        if (c.targetX !== null) {
          newX += (c.targetX - c.x) * 0.1;
          newY += (c.targetY - c.y) * 0.1;
          
          if (Math.abs(c.targetX - newX) < 1 && Math.abs(c.targetY - newY) < 1) {
            newX = c.targetX;
            newY = c.targetY;
          }
        }
        
        newScale += (c.targetScale - c.scale) * 0.1;
        newOpacity += (c.targetOpacity - c.opacity) * 0.08;
        
        return {
          ...c,
          x: newX,
          y: newY,
          scale: newScale,
          opacity: newOpacity,
          morphOffset: c.knowledgebase <= 6 ? Math.sin(time * 0.0005) * 0.1 : 0
        };
      });
      
      const sorted = [...culturesDataRef.current].sort((a, b) => a.layer - b.layer);
      
      sorted.forEach(culture => {
        drawPolygon(ctx, culture, time);
      });
      
      drawParticles(ctx, time);
      
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      sorted.forEach(culture => {
        const isHovered = hoveredCultureRef.current && hoveredCultureRef.current.id === culture.id;
        const renderOpacity = isHovered ? 1.0 : culture.opacity;
        
        if (renderOpacity > 0.6 || isHovered) {
          const fontSize = culture.layer === 3 ? 22 : 16;
          ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
          
          ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur = 8;
          ctx.fillStyle = 'white';
          ctx.globalAlpha = renderOpacity;
          ctx.fillText(culture.name, culture.x, culture.y + culture.size * culture.scale / 2 + 30);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      });
      
      ctx.restore();
      
      // Apply smooth fade overlay
      if (fadeOverlayRef.current > 0.01) {
        ctx.fillStyle = `rgba(10, 10, 10, ${fadeOverlayRef.current})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      
      setCultures([...culturesDataRef.current]);
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [cultures.length, selectedCulture, isExiting]);

  // Convert screen coordinates to world coordinates
  const screenToWorld = (screenX, screenY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;
    
    return {
      x: (canvasX + cameraRef.current.x) / cameraRef.current.zoom,
      y: (canvasY + cameraRef.current.y) / cameraRef.current.zoom
    };
  };

  // Mouse handlers
  const handleMouseDown = (event) => {
    if (event.button !== 0) return;
    
    const worldPos = screenToWorld(event.clientX, event.clientY);
    
    let clickedCulture = null;
    for (let culture of [...culturesDataRef.current].reverse()) {
      const dist = Math.sqrt((worldPos.x - culture.x) ** 2 + (worldPos.y - culture.y) ** 2);
      if (dist < (culture.size * culture.scale) / 2) {
        clickedCulture = culture;
        break;
      }
    }
    
    if (clickedCulture) {
      handleCultureClick(clickedCulture);
    } else {
      setIsDragging(true);
      setLastMousePos({ x: event.clientX, y: event.clientY });
    }
  };

  const handleMouseMove = (event) => {
    if (isDragging) {
      const deltaX = event.clientX - lastMousePos.x;
      const deltaY = event.clientY - lastMousePos.y;
      
      cameraRef.current = {
        x: cameraRef.current.x - deltaX,
        y: cameraRef.current.y - deltaY,
        zoom: cameraRef.current.zoom
      };
      
      const canvas = canvasRef.current;
      if (canvas) {
        cameraRef.current.x = Math.max(0, Math.min(WORLD_WIDTH - canvas.width, cameraRef.current.x));
        cameraRef.current.y = Math.max(0, Math.min(WORLD_HEIGHT - canvas.height, cameraRef.current.y));
      }
      
      setCamera({ ...cameraRef.current });
      setLastMousePos({ x: event.clientX, y: event.clientY });
    } else {
      const worldPos = screenToWorld(event.clientX, event.clientY);
      
      let found = null;
      for (let culture of [...culturesDataRef.current].reverse()) {
        const dist = Math.sqrt((worldPos.x - culture.x) ** 2 + (worldPos.y - culture.y) ** 2);
        if (dist < (culture.size * culture.scale) / 2) {
          found = culture;
          break;
        }
      }
      
      hoveredCultureRef.current = found;
      setHoveredCulture(found);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Zoom control functions
  const handleZoomIn = () => {
    if (selectedCulture) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    const zoomFactor = 1.2;
    const newZoom = Math.min(5, cameraRef.current.zoom * zoomFactor);
    
    const worldX = (centerX + cameraRef.current.x) / cameraRef.current.zoom;
    const worldY = (centerY + cameraRef.current.y) / cameraRef.current.zoom;
    
    cameraRef.current = {
      x: worldX * newZoom - centerX,
      y: worldY * newZoom - centerY,
      zoom: newZoom
    };
    
    setCamera({ ...cameraRef.current });
  };

  const handleZoomOut = () => {
    if (selectedCulture) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    const zoomFactor = 0.8;
    const newZoom = Math.max(0.1, cameraRef.current.zoom * zoomFactor);
    
    const worldX = (centerX + cameraRef.current.x) / cameraRef.current.zoom;
    const worldY = (centerY + cameraRef.current.y) / cameraRef.current.zoom;
    
    cameraRef.current = {
      x: worldX * newZoom - centerX,
      y: worldY * newZoom - centerY,
      zoom: newZoom
    };
    
    setCamera({ ...cameraRef.current });
  };

  const handleZoomReset = () => {
    if (selectedCulture) return;
    
    if (culturesDataRef.current.length === 0) return;
    
    const avgX = culturesDataRef.current.reduce((sum, c) => sum + c.x, 0) / culturesDataRef.current.length;
    const avgY = culturesDataRef.current.reduce((sum, c) => sum + c.y, 0) / culturesDataRef.current.length;
    
    const canvas = canvasRef.current;
    if (canvas) {
      cameraRef.current = {
        x: avgX - canvas.width / 2,
        y: avgY - canvas.height / 2,
        zoom: 1
      };
      setCamera({ ...cameraRef.current });
    }
  };

  // Resize canvas to match container
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    
    return () => window.removeEventListener('resize', handleResize);
  }, [cultures.length]);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      backgroundColor: '#0a0a0a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontFamily: 'system-ui, sans-serif',
      overflow: 'hidden'
    }}>
      {cultures.length === 0 ? (
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ marginBottom: '2rem', fontSize: '2.5rem', fontWeight: '300' }}>
            Belonging
          </h1>
          <p style={{ marginBottom: '2rem', color: '#888' }}>
            Upload your Belonging CSV to visualize cultural kinships
          </p>
          <label style={{
            padding: '1rem 2rem',
            backgroundColor: '#2563eb',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'inline-block',
            fontWeight: '500'
          }}>
            Choose CSV File
            <input 
              type="file" 
              accept=".csv" 
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      ) : (
        <>
          <div style={{ 
            position: 'absolute', 
            top: '1.5rem', 
            left: '1.5rem',
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.85)',
            padding: '1.5rem',
            borderRadius: '12px',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: '600' }}>
              {cultures.length} Cultures
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#888' }}>
              {selectedCulture 
                ? '🎯 Viewing kinship network' 
                : '🖱️ Drag to pan • Click culture to focus'}
            </p>
            {selectedCulture && (
              <p style={{ margin: '1rem 0 0 0', fontSize: '0.95rem', color: '#60a5fa', fontWeight: '500' }}>
                → {selectedCulture.name}
              </p>
            )}
          </div>

          {/* EXIT BUTTON - Only shows in focus mode */}
          {selectedCulture && (
            <div style={{
              position: 'absolute',
              top: '1.5rem',
              right: '1.5rem',
              zIndex: 10
            }}>
              <button
                onClick={handleExitFocus}
                disabled={isExiting}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: isExiting ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  color: isExiting ? '#666' : '#999',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  cursor: isExiting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s',
                  backdropFilter: 'blur(10px)',
                  opacity: isExiting ? 0.5 : 1
                }}
                onMouseEnter={(e) => {
                  if (!isExiting) {
                    e.target.style.backgroundColor = 'rgba(255,255,255,0.15)';
                    e.target.style.color = 'white';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isExiting) {
                    e.target.style.backgroundColor = 'rgba(255,255,255,0.1)';
                    e.target.style.color = '#999';
                  }
                }}
              >
                {isExiting ? '⟳ Transitioning...' : '← Back'}
              </button>
            </div>
          )}

          <div style={{ 
            position: 'absolute', 
            bottom: '2rem', 
            right: '2rem',
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.85)',
            padding: '0.75rem',
            borderRadius: '12px',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            opacity: selectedCulture ? 0.4 : 1
          }}>
            <button
              onClick={handleZoomIn}
              style={{
                width: '40px',
                height: '40px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
                color: 'white',
                fontSize: '1.5rem',
                cursor: selectedCulture ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => !selectedCulture && (e.target.style.backgroundColor = 'rgba(255,255,255,0.2)')}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
              title={selectedCulture ? "Zoom locked in focus mode" : "Zoom In"}
            >
              +
            </button>
            <button
              onClick={handleZoomOut}
              style={{
                width: '40px',
                height: '40px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
                color: 'white',
                fontSize: '1.5rem',
                cursor: selectedCulture ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => !selectedCulture && (e.target.style.backgroundColor = 'rgba(255,255,255,0.2)')}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
              title={selectedCulture ? "Zoom locked in focus mode" : "Zoom Out"}
            >
              −
            </button>
            <button
              onClick={handleZoomReset}
              style={{
                width: '40px',
                height: '40px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
                color: 'white',
                fontSize: '0.9rem',
                cursor: selectedCulture ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => !selectedCulture && (e.target.style.backgroundColor = 'rgba(255,255,255,0.2)')}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
              title={selectedCulture ? "Zoom locked in focus mode" : "Reset Zoom"}
            >
              ⊙
            </button>
            <div style={{
              fontSize: '0.75rem',
              color: '#888',
              textAlign: 'center',
              marginTop: '0.25rem'
            }}>
              {selectedCulture ? "🔒 100%" : `${Math.round(camera.zoom * 100)}%`}
            </div>
          </div>
          
          <div 
            ref={containerRef}
            style={{ 
              width: '100%', 
              height: '100%',
              cursor: isDragging ? 'grabbing' : (hoveredCulture ? 'pointer' : 'grab'),
              overflow: 'hidden',
              position: 'relative'
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <canvas
              ref={canvasRef}
              style={{
                display: 'block',
                width: '100%',
                height: '100%'
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default KinshipVisualization;