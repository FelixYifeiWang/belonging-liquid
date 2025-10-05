import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';

// Utility: Hash string to hue (0-360)
const hashToHue = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 360);
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
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const particlesRef = useRef([]);
  const culturesDataRef = useRef([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });

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
    
    culturesData.forEach((culture) => {
      const particleCount = Math.min(15, Math.max(8, culture.values.length * 3));
      
      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (culture.size / 2 - 15);
        
        newParticles.push({
          cultureId: culture.id,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          color: culture.colors[Math.floor(Math.random() * culture.colors.length)],
          size: 2 + Math.random() * 2,
          wavePhase: Math.random() * Math.PI * 2
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

  // Exit focus mode handler
  const handleExitFocus = () => {
    const focusedCultureId = selectedCulture?.id;
    setSelectedCulture(null);
    randomizeCulturePositions(focusedCultureId);
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
    
    setTimeout(() => {
      setIsTransitioning(false);
    }, 800);
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
    const renderOpacity = (hoveredCulture && hoveredCulture.id === culture.id) ? 1.0 : opacity;
    
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

  // Draw particles
  const drawParticles = (ctx, time) => {
    particlesRef.current.forEach(particle => {
      const culture = culturesDataRef.current.find(c => c.id === particle.cultureId);
      if (!culture || culture.opacity < 0.15) return;
      
      // Boost opacity to 100% if hovered (same as focused mode)
      const renderOpacity = (hoveredCulture && hoveredCulture.id === culture.id) ? 1.0 : culture.opacity;
      
      let waveOffset = 0;
      culture.frequencies.forEach((freq) => {
        const phase = (time / freq) * Math.PI * 2 + particle.wavePhase;
        waveOffset += Math.sin(phase) * 5;
      });
      
      particle.x += particle.vx;
      particle.y += particle.vy;
      
      const dist = Math.sqrt(particle.x ** 2 + particle.y ** 2);
      const maxDist = (culture.size * culture.scale) / 2 - 12;
      if (dist > maxDist) {
        const angle = Math.atan2(particle.y, particle.x);
        particle.x = Math.cos(angle) * maxDist;
        particle.y = Math.sin(angle) * maxDist;
        particle.vx *= -0.5;
        particle.vy *= -0.5;
      }
      
      const worldX = culture.x + particle.x + waveOffset * 0.3;
      const worldY = culture.y + particle.y + waveOffset * 0.3;
      
      ctx.globalAlpha = renderOpacity * 0.95;
      ctx.beginPath();
      ctx.arc(worldX, worldY, particle.size, 0, Math.PI * 2);
      ctx.fillStyle = particle.color;
      ctx.fill();
      ctx.globalAlpha = 1;
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
      
      if (!selectedCulture) {
        applyForces();
      }
      
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
        const isHovered = hoveredCulture && hoveredCulture.id === culture.id;
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
      
      setCultures([...culturesDataRef.current]);
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [cultures.length, selectedCulture, hoveredCulture]);

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
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  color: '#999',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s',
                  backdropFilter: 'blur(10px)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = 'rgba(255,255,255,0.15)';
                  e.target.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  e.target.style.color = '#999';
                }}
              >
                ← Back
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