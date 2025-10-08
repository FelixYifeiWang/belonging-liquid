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
  const [visualMode, setVisualMode] = useState('default'); // 'default' or 'borderless'
  const [selectedScope, setSelectedScope] = useState('all'); // scope filter
  const [scopeLevels, setScopeLevels] = useState(['all']); // available scope levels
  const [isScopeFilterOpen, setIsScopeFilterOpen] = useState(true); // scope filter fold state
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 }); // cursor position for tooltips
  const [searchQuery, setSearchQuery] = useState(''); // search query
  const [searchResults, setSearchResults] = useState([]); // search results
  const [showSearchDropdown, setShowSearchDropdown] = useState(false); // show dropdown
  const [zoomCounter, setZoomCounter] = useState(0); // track consecutive zoom actions
  const [lastZoom, setLastZoom] = useState(1); // track last zoom level
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const particlesRef = useRef([]);
  const culturesDataRef = useRef([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const fadeOverlayRef = useRef(0);
  const targetFadeRef = useRef(0);
  const hoveredCultureRef = useRef(null);
  const targetCameraRef = useRef(null); // For smooth camera transitions
  const isDraggingRef = useRef(false); // Track dragging state in ref for animation loop

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
    const scopeSet = new Set();
    
    data.forEach((row, index) => {
      const rawName = Object.values(row)[1] || `Culture ${index + 1}`;
      const cultureName = cleanCultureName(rawName);
      const valuesText = Object.values(row)[2] || '';
      const kinshipsText = Object.values(row)[4] || '';
      const knowledgebase = parseInt(Object.values(row)[5]) || 5;
      const openness = parseInt(Object.values(row)[6]) || 5;
      const scopeText = Object.values(row)[8] || '';
      const practicesText = Object.values(row)[9] || '';
      const affiliationsText = Object.values(row)[10] || ''; // New: affiliations column
      
      // Extract scope level for filtering
      let scopeLevel = 'local'; // Default to local if not specified
      const lower = scopeText.toLowerCase();
      if (lower.includes('international') || lower.includes('global')) scopeLevel = 'global';
      else if (lower.includes('national')) scopeLevel = 'national';
      else if (lower.includes('regional') || lower.includes('state')) scopeLevel = 'regional';
      else if (lower.includes('local') || lower.includes('community')) scopeLevel = 'local';
      else if (lower.includes('family') || lower.includes('personal')) scopeLevel = 'family';
      
      scopeSet.add(scopeLevel);
      
      const values = valuesText.split(',').map(v => v.trim()).filter(v => v);
      const colors = values.map(v => `hsl(${hashToHue(v)}, 70%, 60%)`);
      
      // Kinships: peer-to-peer relationships (same scope level)
      const kinships = kinshipsText
        .split(',')
        .map(k => cleanCultureName(k.trim()))
        .filter(k => k && k !== 'Culture');
      
      // Affiliations: hierarchical relationships (to 1 level higher scope)
      const affiliations = affiliationsText
        .split(',')
        .map(a => cleanCultureName(a.trim()))
        .filter(a => a && a !== 'Culture');
      
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
        kinships, // peer relationships
        affiliations, // hierarchical relationships
        sides: 3, // Will be calculated after all cultures are loaded
        knowledgebase,
        openness,
        size,
        frequencies,
        scopeLevel,
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
    
    // TEMPORARY: Auto-generate affiliations for testing
    // Each culture has a 60% chance to affiliate with a random culture 1 level higher
    const scopeHierarchy = ['family', 'local', 'regional', 'national', 'global'];
    
    mergedCultures.forEach(culture => {
      const currentScopeIndex = scopeHierarchy.indexOf(culture.scopeLevel);
      
      // Find cultures 1 level higher
      if (currentScopeIndex >= 0 && currentScopeIndex < scopeHierarchy.length - 1) {
        const higherScope = scopeHierarchy[currentScopeIndex + 1];
        const higherScopeCultures = mergedCultures.filter(c => c.scopeLevel === higherScope);
        
        // 60% chance to have an affiliation
        if (higherScopeCultures.length > 0 && Math.random() < 0.6) {
          const randomParent = higherScopeCultures[Math.floor(Math.random() * higherScopeCultures.length)];
          culture.affiliations = [randomParent.name];
        }
      }
    });
    
    // Calculate sides based on ONLY kinships (peer relationships)
    // Affiliations are hierarchical and will be visualized differently
    mergedCultures.forEach(culture => {
      let connectedCount = 0;
      
      mergedCultures.forEach(otherCulture => {
        if (culture.id === otherCulture.id) return;
        
        // Check kinship (peer) connections only
        const isKin = culture.kinships.some(k => 
          otherCulture.name.toLowerCase().includes(k.toLowerCase()) || 
          k.toLowerCase().includes(otherCulture.name.toLowerCase())
        );
        
        if (isKin) connectedCount++;
      });
      
      // Sides = actual number of found kinship connections (minimum 3 for triangle)
      culture.sides = Math.max(3, connectedCount);
    });
    
    // Set available scope levels - sorted from largest to smallest
    const scopeOrder = ['all', 'global', 'national', 'regional', 'local', 'family'];
    const levels = scopeOrder.filter(scope => scope === 'all' || scopeSet.has(scope));
    setScopeLevels(levels);
    
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
      // Skip parent groups - they'll get particles added dynamically
      if (culture.isParentGroup) return;
      
      // Interior particle count based on trait/value count
      const interiorParticleCount = Math.max(15, culture.values.length * 15);
      
      // Border particle count based on openness (inversely proportional)
      const borderParticleCount = Math.floor((11 - culture.openness) * 5);
      
      // Total particles = interior + border (separate counts)
      const totalParticleCount = interiorParticleCount + borderParticleCount;
      
      // Use golden angle to distribute hues evenly across ALL cultures
      // This ensures maximum color separation between cultures
      const goldenAngle = 137.508; // Golden angle in degrees
      const unifiedHue = (cultureIndex * goldenAngle) % 360;
      
      for (let i = 0; i < totalParticleCount; i++) {
        const isBorder = i >= interiorParticleCount; // Border particles come after interior
        
        let x, y;
        if (isBorder) {
          // Position border particles along polygon edges
          const borderIndex = i - interiorParticleCount;
          const edgeProgress = borderIndex / borderParticleCount;
          const totalEdgeLength = culture.sides;
          const position = edgeProgress * totalEdgeLength;
          const edgeIndex = Math.floor(position);
          const edgeT = position - edgeIndex;
          
          const angleStep = (Math.PI * 2) / culture.sides;
          const angle1 = angleStep * edgeIndex;
          const angle2 = angleStep * ((edgeIndex + 1) % culture.sides);
          const radius = culture.size / 2 - 12;
          
          const x1 = Math.cos(angle1) * radius;
          const y1 = Math.sin(angle1) * radius;
          const x2 = Math.cos(angle2) * radius;
          const y2 = Math.sin(angle2) * radius;
          
          x = x1 + (x2 - x1) * edgeT;
          y = y1 + (y2 - y1) * edgeT;
        } else {
          // Position interior particles randomly inside
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * (culture.size / 2 - 20);
          x = Math.cos(angle) * radius;
          y = Math.sin(angle) * radius;
        }
        
        // Very high saturation for vibrant, distinct colors
        const saturation = 80 + Math.random() * 15; // 80-95%
        const lightness = 55 + Math.random() * 10; // 55-65%
        
        newParticles.push({
          cultureId: culture.id,
          homeCultureId: culture.id,
          x: x,
          y: y,
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
          activationStartTime: 0,
          isBorderParticle: isBorder,
          borderEdgeIndex: isBorder ? Math.floor((i - interiorParticleCount) / borderParticleCount * culture.sides) : -1,
          borderEdgeT: isBorder ? ((i - interiorParticleCount) / borderParticleCount * culture.sides) % 1 : 0,
          borderFloatPhase: Math.random() * Math.PI * 2,
          lastSwapTime: 0
        });
      }
    });
    
    particlesRef.current = newParticles;
  };

  // Handle search query
  const handleSearch = (query) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }
    
    // Filter cultures by search query and scope filter
    const lowerQuery = query.toLowerCase();
    const results = culturesDataRef.current.filter(c => {
      if (c.isParentGroup) return false; // Exclude parent groups
      
      const matchesSearch = c.name.toLowerCase().includes(lowerQuery);
      const matchesScope = selectedScope === 'all' || c.scopeLevel === selectedScope;
      
      return matchesSearch && matchesScope;
    });
    
    setSearchResults(results);
    setShowSearchDropdown(true); // Always show dropdown when typing
  };

  // Move camera to selected culture (smooth animation)
  const moveCameraToShape = (culture) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const targetX = culture.x - canvas.width / 2;
    const targetY = culture.y - canvas.height / 2;
    
    // Set target camera position for smooth transition
    targetCameraRef.current = {
      x: Math.max(0, Math.min(WORLD_WIDTH - canvas.width, targetX)),
      y: Math.max(0, Math.min(WORLD_HEIGHT - canvas.height, targetY)),
      zoom: 1
    };
    
    // Close dropdown
    setShowSearchDropdown(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showSearchDropdown && !event.target.closest('.search-container')) {
        setShowSearchDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSearchDropdown]);

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
    
    // PRESERVE PARTICLES - just update their positions relative to new culture locations
    // Also rebalance border/interior particles after exchanges
    newCultures.forEach(culture => {
      const cultureParticles = particlesRef.current.filter(p => p.homeCultureId === culture.id);
      
      const interiorCount = Math.max(15, culture.values.length * 15);
      const borderCount = Math.floor((11 - culture.openness) * 5);
      const expectedTotal = interiorCount + borderCount;
      
      // If particle count doesn't match (due to exchanges), adjust border/interior distribution
      let currentInteriorCount = 0;
      
      cultureParticles.forEach((particle, index) => {
        const shouldBeBorder = currentInteriorCount >= interiorCount;
        
        particle.cultureId = particle.homeCultureId;
        particle.state = 'contained';
        particle.targetCultureId = null;
        particle.flowPartner = null;
        particle.activationDelay = 0;
        particle.activationStartTime = 0;
        particle.vx = (Math.random() - 0.5) * 0.3;
        particle.vy = (Math.random() - 0.5) * 0.3;
        particle.isBorderParticle = shouldBeBorder;
        
        if (!shouldBeBorder) currentInteriorCount++;
      });
    });
    
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
          state: 'activating',
          targetCultureId: targetId,
          flowPartner: focusedId,
          flowProgress: 0,
          activationDelay: Math.random() * 2000,
          activationStartTime: Date.now(),
          baseSpeed: 0.3 + Math.random() * 0.3
        };
      }
      
      // 10% of particles from connected cultures will flow (reduced from 40%)
      if (isInConnected && Math.random() < 0.1) {
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
    
    // Only draw border in default mode
    if (visualMode === 'default') {
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
    }
    
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

  // Draw border particles (borderless mode only)
  const drawBorderParticles = (ctx, culture, time) => {
    if (visualMode !== 'borderless') return;
    
    const { x, y, sides, size, scale, openness, rotation, morphOffset, opacity } = culture;
    const renderOpacity = (hoveredCultureRef.current && hoveredCultureRef.current.id === culture.id) ? 1.0 : opacity;
    
    if (renderOpacity < 0.15) return;
    
    // Border particle count inversely proportional to openness
    // Less open (1-3) = more particles, More open (8-10) = fewer particles
    const borderParticleCount = Math.floor((11 - openness) * 5);
    
    // Get a sample particle color from this culture's particles
    const cultureParticles = particlesRef.current.filter(p => p.homeCultureId === culture.id);
    const sampleColor = cultureParticles.length > 0 ? cultureParticles[0].color : 'rgba(255,255,255,0.8)';
    
    const radius = (size * scale) / 2;
    const angleStep = (Math.PI * 2) / sides;
    const apothem = radius * Math.cos(Math.PI / sides);
    
    ctx.save();
    ctx.globalAlpha = renderOpacity * 0.9;
    
    // Distribute particles evenly along all edges
    const particlesPerEdge = Math.ceil(borderParticleCount / sides);
    
    for (let edgeIdx = 0; edgeIdx < sides; edgeIdx++) {
      // Get edge vertices
      const angle1 = rotation + morphOffset + angleStep * edgeIdx;
      const angle2 = rotation + morphOffset + angleStep * ((edgeIdx + 1) % sides);
      
      const x1 = x + Math.cos(angle1) * radius;
      const y1 = y + Math.sin(angle1) * radius;
      const x2 = x + Math.cos(angle2) * radius;
      const y2 = y + Math.sin(angle2) * radius;
      
      // Place particles along this edge
      for (let i = 0; i < particlesPerEdge; i++) {
        const t = (i + 0.5) / particlesPerEdge; // Position along edge (0 to 1)
        
        // Add slight animation/wave to border particles
        const waveOffset = Math.sin(time * 0.002 + edgeIdx + i * 0.5) * 3;
        
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        
        // Draw border particle
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = sampleColor;
        ctx.fill();
      }
    }
    
    ctx.globalAlpha = 1;
    ctx.restore();
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
        // Check if we're in borderless mode and this is a border particle
        if (visualMode === 'borderless' && particle.isBorderParticle) {
          // Border particle behavior: float along edge
          const angleStep = (Math.PI * 2) / culture.sides;
          const angle1 = culture.rotation + culture.morphOffset + angleStep * particle.borderEdgeIndex;
          const angle2 = culture.rotation + culture.morphOffset + angleStep * ((particle.borderEdgeIndex + 1) % culture.sides);
          const radius = (culture.size * culture.scale) / 2 - 12;
          
          const x1 = Math.cos(angle1) * radius;
          const y1 = Math.sin(angle1) * radius;
          const x2 = Math.cos(angle2) * radius;
          const y2 = Math.sin(angle2) * radius;
          
          // Calculate base position along edge
          const baseX = x1 + (x2 - x1) * particle.borderEdgeT;
          const baseY = y1 + (y2 - y1) * particle.borderEdgeT;
          
          // Add floating motion perpendicular to edge
          const edgeAngle = Math.atan2(y2 - y1, x2 - x1);
          const perpAngle = edgeAngle + Math.PI / 2;
          const floatAmount = Math.sin(time * 0.003 + particle.borderFloatPhase) * 4;
          
          particle.x = baseX + Math.cos(perpAngle) * floatAmount;
          particle.y = baseY + Math.sin(perpAngle) * floatAmount;
          
          // Drift slightly along edge
          particle.borderEdgeT += (Math.random() - 0.5) * 0.002;
          particle.borderEdgeT = Math.max(0, Math.min(1, particle.borderEdgeT));
          
          // Randomly swap with interior particle (5% chance per second)
          if (Date.now() - particle.lastSwapTime > 1000 && Math.random() < 0.05) {
            const interiorParticles = particlesRef.current.filter(
              p => p.homeCultureId === culture.id && 
                   p.state === 'contained' && 
                   !p.isBorderParticle
            );
            
            if (interiorParticles.length > 0) {
              const swapTarget = interiorParticles[Math.floor(Math.random() * interiorParticles.length)];
              
              // Swap border status
              particle.isBorderParticle = false;
              swapTarget.isBorderParticle = true;
              swapTarget.borderEdgeIndex = particle.borderEdgeIndex;
              swapTarget.borderEdgeT = particle.borderEdgeT;
              swapTarget.borderFloatPhase = Math.random() * Math.PI * 2;
              
              particle.lastSwapTime = Date.now();
              swapTarget.lastSwapTime = Date.now();
            }
          }
        } else {
          // Interior particle or default mode behavior
          let waveOffset = 0;
          culture.frequencies.forEach((freq) => {
            const phase = (time / freq) * Math.PI * 2 + particle.wavePhase;
            waveOffset += Math.sin(phase) * 5;
          });
          
          particle.x += particle.vx;
          particle.y += particle.vy;
          
          // Enforce hard polygon boundary
          enforcePolygonBoundary(particle, culture);
        }
        
        const worldX = culture.x + particle.x;
        const worldY = culture.y + particle.y;
        
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
          // Arrived at target culture - EXCHANGE PARTICLES
          if (particle.state === 'flowing') {
            // Decide if this particle should be exchanged
            // 15% exchange rate gives us the right proportions:
            // - Focused (50 flowing) × 15% = ~7.5 particles exchanged out
            // - Surrounding (10 flowing) × 15% = ~1.5 particles exchanged in per group
            const shouldExchange = Math.random() < 0.15;
            
            if (shouldExchange) {
              // PERMANENT TRANSFER: particle joins the target culture
              particle.cultureId = particle.targetCultureId;
              particle.homeCultureId = particle.targetCultureId; // This is now its home
              
              // Position particle inside the new culture (near edge where it entered)
              const entryAngle = Math.atan2(worldY - targetCulture.y, worldX - targetCulture.x);
              const entryRadius = (targetCulture.size * targetCulture.scale) / 2 - 20;
              particle.x = Math.cos(entryAngle) * entryRadius;
              particle.y = Math.sin(entryAngle) * entryRadius;
              
              // Give it gentle inward velocity to settle
              particle.vx = -Math.cos(entryAngle) * 0.2;
              particle.vy = -Math.sin(entryAngle) * 0.2;
              
              // Return to contained state in new home
              particle.state = 'contained';
              particle.targetCultureId = null;
              particle.flowPartner = null;
              particle.baseSpeed = undefined;
              
            } else {
              // Original behavior: cycle back
              particle.cultureId = particle.targetCultureId;
              particle.x = worldX - targetCulture.x;
              particle.y = worldY - targetCulture.y;
              particle.vx *= 0.7;
              particle.vy *= 0.7;
              
              const temp = particle.targetCultureId;
              particle.targetCultureId = particle.flowPartner;
              particle.flowPartner = temp;
            }
            
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
      
      // Smooth camera transition to target (for search) - BEFORE applying transform
      if (targetCameraRef.current && !isDraggingRef.current) {
        const smoothFactor = 0.08;
        const dx = targetCameraRef.current.x - cameraRef.current.x;
        const dy = targetCameraRef.current.y - cameraRef.current.y;
        const dz = targetCameraRef.current.zoom - cameraRef.current.zoom;
        
        cameraRef.current.x += dx * smoothFactor;
        cameraRef.current.y += dy * smoothFactor;
        cameraRef.current.zoom += dz * smoothFactor;
        
        // Clear target when close enough
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(dz) < 0.01) {
          cameraRef.current.x = targetCameraRef.current.x;
          cameraRef.current.y = targetCameraRef.current.y;
          cameraRef.current.zoom = targetCameraRef.current.zoom;
          targetCameraRef.current = null;
        }
      }
      
      ctx.save();
      ctx.translate(-cameraRef.current.x, -cameraRef.current.y);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);
      
      if (!selectedCulture && !isExiting) {
        applyForces();
      }
      
      // Apply scope filter and create parent groups for affiliations
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
        
        // Apply scope filter ONLY when not in focused mode
        // In focused mode, we want to see all kinships regardless of scope
        if (!selectedCulture) {
          const matchesScope = selectedScope === 'all' || c.scopeLevel === selectedScope;
          if (!matchesScope && !c.isParentGroup) {
            newOpacity = 0;
            newScale = 0.1;
          }
        }
        
        return {
          ...c,
          x: newX,
          y: newY,
          scale: newScale,
          opacity: newOpacity,
          morphOffset: c.knowledgebase <= 6 ? Math.sin(time * 0.0005) * 0.1 : 0
        };
      });
      
      // When a specific scope is filtered, show parent groups
      if (selectedScope !== 'all') {
        const visibleCultures = culturesDataRef.current.filter(c => 
          c.scopeLevel === selectedScope && c.opacity > 0.1
        );
        
        // Determine what scope level is 1 level higher
        const scopeHierarchy = ['family', 'local', 'regional', 'national', 'global'];
        const currentScopeIndex = scopeHierarchy.indexOf(selectedScope);
        const parentScopeLevel = currentScopeIndex >= 0 && currentScopeIndex < scopeHierarchy.length - 1 
          ? scopeHierarchy[currentScopeIndex + 1] 
          : null;
        
        // Group children by their parent affiliation
        const parentGroups = new Map();
        visibleCultures.forEach(culture => {
          if (culture.affiliations && culture.affiliations.length > 0) {
            const parentName = culture.affiliations[0];
            
            // Find the actual parent culture to verify it's 1 level higher
            const parentCulture = culturesDataRef.current.find(c => 
              c.name === parentName && !c.isParentGroup
            );
            
            // Only create parent group if parent is exactly 1 level higher
            if (parentCulture && parentCulture.scopeLevel === parentScopeLevel) {
              if (!parentGroups.has(parentName)) {
                parentGroups.set(parentName, []);
              }
              parentGroups.get(parentName).push(culture);
            }
          }
        });
        
        // Helper function to check if two shapes overlap
        const shapesOverlap = (shape1, shape2, padding = 300) => {
          const dx = shape1.x - shape2.x;
          const dy = shape1.y - shape2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = (shape1.size * shape1.scale) / 2 + (shape2.size * shape2.scale) / 2 + padding;
          return dist < minDist;
        };
        
        // Helper function to find non-overlapping position for parent group
        const findNonOverlappingPosition = (size, existingShapes) => {
          const maxAttempts = 50;
          let bestPosition = null;
          let bestMinDistance = 0;
          
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const testX = WORLD_WIDTH / 2 + (Math.random() - 0.5) * WORLD_WIDTH * 0.6;
            const testY = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * WORLD_HEIGHT * 0.6;
            const testShape = { x: testX, y: testY, size, scale: 1 };
            
            let overlaps = false;
            let minDistance = Infinity;
            
            for (const existing of existingShapes) {
              if (shapesOverlap(testShape, existing)) {
                overlaps = true;
                break;
              }
              const dx = testX - existing.x;
              const dy = testY - existing.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              minDistance = Math.min(minDistance, dist);
            }
            
            if (!overlaps) {
              return { x: testX, y: testY };
            }
            
            // Track best position even if overlapping
            if (minDistance > bestMinDistance) {
              bestMinDistance = minDistance;
              bestPosition = { x: testX, y: testY };
            }
          }
          
          // Return best attempt if couldn't find perfect position
          return bestPosition || {
            x: WORLD_WIDTH / 2 + (Math.random() - 0.5) * WORLD_WIDTH * 0.4,
            y: WORLD_HEIGHT / 2 + (Math.random() - 0.5) * WORLD_HEIGHT * 0.4
          };
        };
        
        // Create or update parent group visualizations
        const existingParents = [];
        parentGroups.forEach((children, parentName) => {
          // Find or create parent group
          let parent = culturesDataRef.current.find(c => 
            c.name === parentName && c.isParentGroup
          );
          
          if (!parent) {
            // Create new parent group with overlap checking
            
            // Calculate appropriate size based on number of children
            const baseSize = 800;
            const sizePerChild = 300;
            const totalSize = baseSize + (children.length * sizePerChild);
            
            // Get all shapes to check against (existing parents + visible cultures)
            const shapesToAvoid = [
              ...existingParents,
              ...visibleCultures.map(c => ({ x: c.x, y: c.y, size: c.size, scale: c.scale }))
            ];
            
            // Find non-overlapping position
            const position = findNonOverlappingPosition(totalSize, shapesToAvoid);
            
            // Find the original parent culture to get its shape properties AND color
            const originalParent = culturesDataRef.current.find(c => 
              c.name === parentName && !c.isParentGroup
            );
            const parentSides = originalParent ? originalParent.sides : 6;
            const parentKnowledgebase = originalParent ? originalParent.knowledgebase : 8;
            const parentOpenness = originalParent ? originalParent.openness : 8;
            
            // Get the original parent's color hue
            let parentHue = Math.random() * 360;
            if (originalParent) {
              const originalParentParticles = particlesRef.current.filter(p => 
                p.homeCultureId === originalParent.id && !p.isBorderParticle
              );
              if (originalParentParticles.length > 0) {
                // Extract hue from first particle's color
                const colorMatch = originalParentParticles[0].color.match(/hsl\((\d+)/);
                if (colorMatch) {
                  parentHue = parseInt(colorMatch[1]);
                }
              }
            }
            
            parent = {
              id: `parent_${parentName}`,
              name: parentName,
              isParentGroup: true,
              x: position.x,
              y: position.y,
              homeX: position.x,
              homeY: position.y,
              size: totalSize,
              scale: 1,
              targetScale: 1,
              opacity: 0.45,
              targetOpacity: 0.45,
              rotation: Math.random() * Math.PI * 2,
              morphOffset: 0,
              sides: parentSides,
              knowledgebase: parentKnowledgebase,
              openness: parentOpenness,
              layer: -1,
              scopeLevel: 'parent',
              vx: 0,
              vy: 0,
              targetX: null,
              targetY: null,
              values: [],
              colors: [],
              kinships: [],
              affiliations: [],
              frequencies: []
            };
            
            culturesDataRef.current.push(parent);
            existingParents.push(parent); // Track for next parent group's overlap check
            
            // Create particles with SAME hue as original parent culture
            const parentParticleCount = 80;
            
            for (let i = 0; i < parentParticleCount; i++) {
              const angle = Math.random() * Math.PI * 2;
              const radius = Math.random() * (parent.size / 2 - 20);
              
              particlesRef.current.push({
                cultureId: parent.id,
                homeCultureId: parent.id,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                vx: (Math.random() - 0.5) * 0.2,
                vy: (Math.random() - 0.5) * 0.2,
                color: `hsl(${parentHue}, 65%, 60%)`, // Use original parent's hue
                size: 2.5,
                wavePhase: Math.random() * Math.PI * 2,
                state: 'contained',
                targetCultureId: null,
                flowPartner: null,
                flowProgress: 0,
                baseSpeed: 0.2,
                activationDelay: 0,
                activationStartTime: 0,
                isBorderParticle: false,
                borderEdgeIndex: -1,
                borderEdgeT: 0,
                borderFloatPhase: 0,
                lastSwapTime: 0
              });
            }
            
            // Position children within this new parent
            const parentRadius = parent.size / 2;
            const angleStep = (Math.PI * 2) / children.length;
            
            children.forEach((child, index) => {
              const childAngle = angleStep * index;
              const distFromCenter = Math.max(100, parentRadius - child.size * child.scale / 2 - 200);
              
              child.x = parent.x + Math.cos(childAngle) * distFromCenter * 0.6;
              child.y = parent.y + Math.sin(childAngle) * distFromCenter * 0.6;
              child.homeX = child.x;
              child.homeY = child.y;
            });
          } else {
            // Update existing parent - keep it centered on children
            const centerX = children.reduce((sum, c) => sum + c.x, 0) / children.length;
            const centerY = children.reduce((sum, c) => sum + c.y, 0) / children.length;
            
            parent.x = centerX;
            parent.y = centerY;
            
            // Ensure children stay within parent
            const parentRadius = parent.size / 2;
            children.forEach(child => {
              const dx = child.x - parent.x;
              const dy = child.y - parent.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const maxDist = parentRadius - child.size * child.scale / 2 - 150;
              
              if (dist > maxDist && maxDist > 0) {
                const angle = Math.atan2(dy, dx);
                child.x = parent.x + Math.cos(angle) * maxDist;
                child.y = parent.y + Math.sin(angle) * maxDist;
              }
            });
          }
        });
        
        // Remove parent groups that are no longer needed
        culturesDataRef.current = culturesDataRef.current.filter(c => {
          if (!c.isParentGroup) return true;
          return parentGroups.has(c.name);
        });
        
        // Apply separation force to prevent parent group overlaps
        const allParents = culturesDataRef.current.filter(c => c.isParentGroup);
        const separationIterations = 10;
        const separationForce = 50;
        
        for (let iteration = 0; iteration < separationIterations; iteration++) {
          allParents.forEach((p1, i) => {
            allParents.forEach((p2, j) => {
              if (i >= j) return; // Skip self and already checked pairs
              
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const minDist = (p1.size / 2) + (p2.size / 2) + 400; // 400px padding
              
              if (dist < minDist && dist > 0) {
                const overlap = minDist - dist;
                const pushX = (dx / dist) * overlap * 0.5;
                const pushY = (dy / dist) * overlap * 0.5;
                
                p1.x -= pushX;
                p1.y -= pushY;
                p2.x += pushX;
                p2.y += pushY;
                
                // Update home positions too
                p1.homeX = p1.x;
                p1.homeY = p1.y;
                p2.homeX = p2.x;
                p2.homeY = p2.y;
              }
            });
          });
        }
        
        // After separating parents, ensure children stay within their parent bounds
        parentGroups.forEach((children, parentName) => {
          const parent = culturesDataRef.current.find(c => 
            c.name === parentName && c.isParentGroup
          );
          
          if (parent) {
            const parentRadius = parent.size / 2;
            children.forEach(child => {
              const dx = child.x - parent.x;
              const dy = child.y - parent.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const maxDist = parentRadius - child.size * child.scale / 2 - 150;
              
              if (dist > maxDist && maxDist > 0) {
                const angle = Math.atan2(dy, dx);
                child.x = parent.x + Math.cos(angle) * maxDist;
                child.y = parent.y + Math.sin(angle) * maxDist;
                child.homeX = child.x;
                child.homeY = child.y;
              }
            });
          }
        });
      } else {
        // Remove all parent groups when "all" is selected
        culturesDataRef.current = culturesDataRef.current.filter(c => !c.isParentGroup);
      }
      
      const sorted = [...culturesDataRef.current].sort((a, b) => a.layer - b.layer);
      
      sorted.forEach(culture => {
        drawPolygon(ctx, culture, time, visualMode);
      });
      
      drawParticles(ctx, time);
      
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      sorted.forEach(culture => {
        const isHovered = hoveredCultureRef.current && hoveredCultureRef.current.id === culture.id;
        const renderOpacity = isHovered ? 1.0 : culture.opacity;
        
        // Show name for regular cultures only (parent groups use cursor tooltip)
        if (!culture.isParentGroup && (renderOpacity > 0.6 || isHovered)) {
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
  }, [cultures.length, selectedCulture, isExiting, visualMode, selectedScope]);

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
      // Skip parent groups - they're not clickable
      if (culture.isParentGroup) continue;
      
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
      isDraggingRef.current = true;
      setLastMousePos({ x: event.clientX, y: event.clientY });
    }
  };

  const handleMouseMove = (event) => {
    // Track cursor position for tooltips
    setCursorPos({ x: event.clientX, y: event.clientY });
    
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
      
      // Cancel smooth camera transition if user starts dragging
      targetCameraRef.current = null;
    } else {
      const worldPos = screenToWorld(event.clientX, event.clientY);
      
      let found = null;
      
      // First priority: check regular cultures (not parent groups)
      for (let culture of [...culturesDataRef.current].reverse()) {
        if (culture.isParentGroup) continue;
        
        const dist = Math.sqrt((worldPos.x - culture.x) ** 2 + (worldPos.y - culture.y) ** 2);
        if (dist < (culture.size * culture.scale) / 2) {
          found = culture;
          break;
        }
      }
      
      // Second priority: check parent groups if no regular culture found
      if (!found) {
        for (let culture of [...culturesDataRef.current].reverse()) {
          if (!culture.isParentGroup) continue;
          
          const dist = Math.sqrt((worldPos.x - culture.x) ** 2 + (worldPos.y - culture.y) ** 2);
          // Use smaller detection area for parent groups (60% of actual size)
          if (dist < (culture.size * culture.scale) / 2 * 0.6) {
            found = culture;
            break;
          }
        }
      }
      
      hoveredCultureRef.current = found;
      setHoveredCulture(found);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    isDraggingRef.current = false;
  };

  // Handle automatic scope change based on zoom
  const handleZoomScopeChange = (newZoom) => {
    if (selectedCulture) return; // Don't change scope in focused mode
    
    const scopeHierarchy = ['all', 'global', 'national', 'regional', 'local'];
    const currentIndex = scopeHierarchy.indexOf(selectedScope);
    
    if (currentIndex === -1) return; // Invalid scope
    
    // Determine zoom direction
    const isZoomingOut = newZoom < lastZoom;
    const isZoomingIn = newZoom > lastZoom;
    
    if (!isZoomingOut && !isZoomingIn) return; // No zoom change
    
    // Update counter based on direction
    let newCounter = zoomCounter;
    
    if ((isZoomingOut && zoomCounter > 0) || (isZoomingIn && zoomCounter < 0)) {
      // Direction changed, reset counter
      newCounter = isZoomingOut ? -1 : 1;
    } else {
      // Same direction, increment counter
      newCounter = isZoomingOut ? zoomCounter - 1 : zoomCounter + 1;
    }
    
    setZoomCounter(newCounter);
    setLastZoom(newZoom);
    
    // Check if we've zoomed 5 times in one direction
    if (newCounter <= -5 && currentIndex < scopeHierarchy.length - 1) {
      // Zoomed out 5 times, move to smaller scope
      setSelectedScope(scopeHierarchy[currentIndex + 1]);
      setZoomCounter(0);
      
      // Reset zoom to 100%
      const canvas = canvasRef.current;
      if (canvas) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const worldX = (centerX + cameraRef.current.x) / cameraRef.current.zoom;
        const worldY = (centerY + cameraRef.current.y) / cameraRef.current.zoom;
        
        cameraRef.current = {
          x: worldX * 1 - centerX,
          y: worldY * 1 - centerY,
          zoom: 1
        };
        setCamera({ ...cameraRef.current });
        setLastZoom(1);
      }
    } else if (newCounter >= 5 && currentIndex > 0) {
      // Zoomed in 5 times, move to larger scope
      setSelectedScope(scopeHierarchy[currentIndex - 1]);
      setZoomCounter(0);
      
      // Reset zoom to 100%
      const canvas = canvasRef.current;
      if (canvas) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const worldX = (centerX + cameraRef.current.x) / cameraRef.current.zoom;
        const worldY = (centerY + cameraRef.current.y) / cameraRef.current.zoom;
        
        cameraRef.current = {
          x: worldX * 1 - centerX,
          y: worldY * 1 - centerY,
          zoom: 1
        };
        setCamera({ ...cameraRef.current });
        setLastZoom(1);
      }
    }
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
    handleZoomScopeChange(newZoom);
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
    handleZoomScopeChange(newZoom);
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
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            maxWidth: '280px'
          }}>
            {/* Info Panel */}
            <div style={{
              backgroundColor: 'rgba(0,0,0,0.85)',
              padding: '1.5rem',
              borderRadius: '12px',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: '600' }}>
                {cultures.filter(c => !c.isParentGroup).length} Cultures
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

            {/* Culture Details Panel - Only in focused mode */}
            {selectedCulture && !selectedCulture.isParentGroup && (
              <div style={{
                backgroundColor: 'rgba(0,0,0,0.85)',
                padding: '1.5rem',
                borderRadius: '12px',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.1)',
                maxHeight: '60vh',
                overflowY: 'auto',
                fontSize: '0.85rem',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.3) rgba(0,0,0,0.3)'
              }}
              className="culture-details-panel"
              >
                <style>{`
                  .culture-details-panel::-webkit-scrollbar {
                    width: 8px;
                  }
                  .culture-details-panel::-webkit-scrollbar-track {
                    background: rgba(0,0,0,0.3);
                    border-radius: 4px;
                  }
                  .culture-details-panel::-webkit-scrollbar-thumb {
                    background: rgba(255,255,255,0.3);
                    border-radius: 4px;
                  }
                  .culture-details-panel::-webkit-scrollbar-thumb:hover {
                    background: rgba(255,255,255,0.4);
                  }
                `}</style>
                <h3 style={{ 
                  margin: '0 0 1rem 0', 
                  fontSize: '1rem', 
                  fontWeight: '600',
                  color: '#60a5fa',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: '0.5rem'
                }}>
                  Culture Details
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Name */}
                  <div>
                    <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>NAME</div>
                    <div style={{ color: 'white', fontWeight: '500' }}>{selectedCulture.name}</div>
                  </div>

                  {/* Scope */}
                  <div>
                    <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>SCOPE</div>
                    <div style={{ color: 'white', textTransform: 'capitalize' }}>{selectedCulture.scopeLevel}</div>
                  </div>

                  {/* Values */}
                  {selectedCulture.values && selectedCulture.values.length > 0 && (
                    <div>
                      <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>VALUES</div>
                      <div style={{ color: 'white' }}>
                        {selectedCulture.values.map((value, idx) => (
                          <span key={idx}>
                            {value}
                            {idx < selectedCulture.values.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Kinships */}
                  {selectedCulture.kinships && selectedCulture.kinships.length > 0 && (
                    <div>
                      <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>KINSHIPS</div>
                      <div style={{ color: 'white' }}>
                        {selectedCulture.kinships.map((kinship, idx) => (
                          <span key={idx}>
                            {kinship}
                            {idx < selectedCulture.kinships.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Affiliations */}
                  {selectedCulture.affiliations && selectedCulture.affiliations.length > 0 && (
                    <div>
                      <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>AFFILIATIONS</div>
                      <div style={{ color: 'white' }}>
                        {selectedCulture.affiliations.map((affiliation, idx) => (
                          <span key={idx}>
                            {affiliation}
                            {idx < selectedCulture.affiliations.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Knowledgebase */}
                  <div>
                    <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>KNOWLEDGEBASE</div>
                    <div style={{ color: 'white' }}>{selectedCulture.knowledgebase}/10</div>
                  </div>

                  {/* Openness */}
                  <div>
                    <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>OPENNESS</div>
                    <div style={{ color: 'white' }}>{selectedCulture.openness}/10</div>
                  </div>

                  {/* Shape Info */}
                  <div>
                    <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>POLYGON SIDES</div>
                    <div style={{ color: 'white' }}>{selectedCulture.sides} sides (based on {selectedCulture.sides - 3} kinship connections)</div>
                  </div>
                </div>
              </div>
            )}

            {/* Search Box - Hidden in focused mode */}
            {!selectedCulture && (
              <div 
                className="search-container"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.85)',
                  padding: '1rem',
                  borderRadius: '12px',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  position: 'relative'
                }}>
              <input
                type="text"
                placeholder="Search cultures..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '0.75rem',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '0.9rem',
                  outline: 'none',
                  fontFamily: 'system-ui, sans-serif'
                }}
              />
              
              {/* Search Results Dropdown */}
              {showSearchDropdown && searchQuery && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '0.5rem',
                  backgroundColor: 'rgba(0,0,0,0.95)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  zIndex: 100,
                  backdropFilter: 'blur(10px)'
                }}>
                  {searchResults.length > 0 ? (
                    searchResults.map((culture) => (
                      <div
                        key={culture.id}
                        onClick={() => moveCameraToShape(culture)}
                        style={{
                          padding: '0.75rem 1rem',
                          cursor: 'pointer',
                          borderBottom: '1px solid rgba(255,255,255,0.1)',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                      >
                        <div style={{ fontSize: '0.9rem', color: 'white', fontWeight: '500' }}>
                          {culture.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem', textTransform: 'capitalize' }}>
                          {culture.scopeLevel}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{
                      padding: '1rem',
                      color: '#888',
                      textAlign: 'center',
                      fontSize: '0.85rem'
                    }}>
                      No cultures found
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </div>

          {/* RIGHT SIDE CONTROLS */}
          <div style={{ 
            position: 'absolute', 
            top: '1.5rem', 
            right: '1.5rem',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            {/* Scope Filter - Top Right, Hidden in focused mode */}
            {!selectedCulture && scopeLevels.length > 1 && (
              <div style={{
                backgroundColor: 'rgba(0,0,0,0.85)',
                padding: '1rem',
                borderRadius: '12px',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.1)',
                minWidth: '200px'
              }}>
                <div 
                  onClick={() => setIsScopeFilterOpen(!isScopeFilterOpen)}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    marginBottom: isScopeFilterOpen ? '0.75rem' : '0'
                  }}
                >
                  <div style={{ fontSize: '0.85rem', color: '#888' }}>
                    Scope: <span style={{ color: '#60a5fa', textTransform: 'capitalize' }}>{selectedScope}</span>
                  </div>
                  <div style={{ 
                    fontSize: '0.75rem', 
                    color: '#888',
                    transform: isScopeFilterOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s'
                  }}>
                    ▼
                  </div>
                </div>
                {isScopeFilterOpen && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  }}>
                    {scopeLevels.map(level => (
                      <button
                        key={level}
                        onClick={() => {
                          setSelectedScope(level);
                          setZoomCounter(0); // Reset zoom counter on manual scope change
                        }}
                        style={{
                          padding: '0.5rem 0.75rem',
                          backgroundColor: selectedScope === level ? 'rgba(96, 165, 250, 0.3)' : 'rgba(255,255,255,0.05)',
                          border: selectedScope === level ? '1px solid rgba(96, 165, 250, 0.5)' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: selectedScope === level ? '#60a5fa' : '#aaa',
                          fontSize: '0.8rem',
                          fontWeight: '500',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          textAlign: 'left',
                          textTransform: 'capitalize'
                        }}
                        onMouseEnter={(e) => {
                          if (selectedScope !== level) {
                            e.target.style.backgroundColor = 'rgba(255,255,255,0.1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedScope !== level) {
                            e.target.style.backgroundColor = 'rgba(255,255,255,0.05)';
                          }
                        }}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Zoom Controls - Top Right, Hidden in focused mode */}
            {!selectedCulture && (
              <div style={{ 
                backgroundColor: 'rgba(0,0,0,0.85)',
                padding: '0.75rem',
                borderRadius: '12px',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                width: 'fit-content',
                alignSelf: 'flex-end'
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
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                title="Zoom In"
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
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                title="Zoom Out"
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
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                title="Reset Zoom"
              >
                ⊙
              </button>
              <div style={{
                fontSize: '0.75rem',
                color: '#888',
                textAlign: 'center',
                marginTop: '0.25rem'
              }}>
                {`${Math.round(camera.zoom * 100)}%`}
              </div>
            </div>
            )}
          </div>

          {/* BOTTOM RIGHT - Visual Mode Toggle */}
          <div style={{ 
            position: 'absolute', 
            bottom: '2rem', 
            right: '2rem',
            zIndex: 10
          }}>
            <div style={{
              backgroundColor: 'rgba(0,0,0,0.85)',
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{ fontSize: '0.85rem', color: '#888' }}>Visual:</span>
              <div style={{
                display: 'flex',
                gap: '0.5rem',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '8px',
                padding: '0.25rem'
              }}>
                <button
                  onClick={() => setVisualMode('default')}
                  style={{
                    padding: '0.4rem 0.75rem',
                    backgroundColor: visualMode === 'default' ? 'rgba(255,255,255,0.2)' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    color: visualMode === 'default' ? 'white' : '#888',
                    fontSize: '0.8rem',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  Default
                </button>
                <button
                  onClick={() => setVisualMode('borderless')}
                  style={{
                    padding: '0.4rem 0.75rem',
                    backgroundColor: visualMode === 'borderless' ? 'rgba(255,255,255,0.2)' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    color: visualMode === 'borderless' ? 'white' : '#888',
                    fontSize: '0.8rem',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  Borderless
                </button>
              </div>
            </div>
          </div>

          {/* EXIT BUTTON - Only shows in focus mode */}
          {selectedCulture && (
            <div style={{
              position: 'absolute',
              top: '1.5rem',
              right: '1.5rem',
              zIndex: 11
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
          
          <div 
            ref={containerRef}
            style={{ 
              width: '100%', 
              height: '100%',
              cursor: isDragging ? 'grabbing' : (hoveredCulture && !hoveredCulture.isParentGroup ? 'pointer' : 'grab'),
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
            
            {/* Parent Group Tooltip */}
            {hoveredCulture && hoveredCulture.isParentGroup && (
              <div style={{
                position: 'absolute',
                left: cursorPos.x + 15,
                top: cursorPos.y + 15,
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                color: 'white',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: '500',
                pointerEvents: 'none',
                zIndex: 1000,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(8px)',
                whiteSpace: 'nowrap'
              }}>
                {hoveredCulture.name}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default KinshipVisualization;