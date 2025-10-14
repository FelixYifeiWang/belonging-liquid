import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';

const CURATE_BOUNDARY_RADIUS = 300; // Circular boundary for particles

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
  const [panelAnimationState, setPanelAnimationState] = useState('closed'); // 'closed', 'opening', 'open', 'closing'
  const [hoveredCulture, setHoveredCulture] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [visualMode, setVisualMode] = useState('borderless'); // 'default' or 'borderless'
  const [selectedScope, setSelectedScope] = useState('all'); // scope filter
  const [scopeLevels, setScopeLevels] = useState(['all']); // available scope levels
  const [isScopeFilterOpen, setIsScopeFilterOpen] = useState(true); // scope filter fold state
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 }); // cursor position for tooltips
  const [searchQuery, setSearchQuery] = useState(''); // search query
  const [searchResults, setSearchResults] = useState([]); // search results
  const [showSearchDropdown, setShowSearchDropdown] = useState(false); // show dropdown
  // const [lastZoom, setLastZoom] = useState(1); // track last zoom level

  // Curate Mode States
  const [mode, setMode] = useState('explore'); // 'explore' or 'curate'
  const [curatedActivities, setCuratedActivities] = useState([]); // Activities that have been curated
  const [curateParticles, setCurateParticles] = useState([]); // Particles for curate mode
  const [selectedCuratedCulture, setSelectedCuratedCulture] = useState(null); // Currently selected culture for detail view in curate mode
  const [showActivityPanel, setShowActivityPanel] = useState(false); // Show activity detail panel
  const [hoveredCurateParticle, setHoveredCurateParticle] = useState(null); // Hovered particle for tooltip
  const [curateSearchInput, setCurateSearchInput] = useState(''); // Curate mode search input
  const [showSuggestionDropdown, setShowSuggestionDropdown] = useState(false);
  const [activeSuggestions, setActiveSuggestions] = useState([]);
  const [curateCursorPos, setCurateCursorPos] = useState({ x: 0, y: 0 }); // For particle tooltips
  const [shapeParticles, setShapeParticles] = useState([]); // Particles for rotating shape in activity panel
  const shapeParticlesRef = useRef([]);
  const shapeAnimationRef = useRef(null);
  
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

  // Curate Mode Refs
  const curateParticlesRef = useRef([]);
  const curateAnimationRef = useRef(null);
  const curateSvgRef = useRef(null);

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

  // Auto-load final.csv on mount
  useEffect(() => {
    const loadCSV = async () => {
      try {
        const response = await fetch('/final.csv');
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        
        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            console.log('CSV loaded, rows:', results.data.length);
            processCultures(results.data);
          },
          error: (error) => {
            console.error('Papa parse error:', error);
          }
        });
      } catch (error) {
        console.error('Error loading final.csv:', error);
        console.log('Make sure final.csv is in the public folder');
      }
    };
    
    loadCSV();
  }, []);

  // Utility: Convert HEX color to HSL hue (0-360)
  const hexToHue = (hex) => {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    
    let h = 0;
    
    if (delta === 0) {
      h = 0;
    } else if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / delta + 2) / 6;
    } else {
      h = ((r - g) / delta + 4) / 6;
    }
    
    return h * 360;
  };

  // Process CSV data with precomputed values from processor
  const processCultures = (data) => {
    const processed = [];
    const placedCultures = [];
    const scopeSet = new Set();
    
    data.forEach((row, index) => {
      // Use named columns from new CSV format
      const cultureName = row['Name'] || `Culture ${index + 1}`;
      const kinshipsText = row['Kinships'] || '';
      const affiliationsText = row['Affiliation'] || '';
      const knowledgebase = parseInt(row['Knowledgebase']) || 5;
      const openness = parseInt(row['Openness']) || 5;
      const language = parseInt(row['Language']) || 3; 
      
      // Use precomputed values from processor
      const toCount = (v, fallback, scale = 1, mode = 'round', min = 0) => {
        const n = Number.parseInt(String(v ?? ''), 10);
        if (Number.isNaN(n)) return fallback;
        const scaled = n / scale;
        const op = Math[mode];
        return Math.max(min, op(scaled));
      };

      const sides = parseInt(row['Sides']) || 3;
      const interiorParticleCount = toCount(row['InteriorParticleCount'], 50, 2, 'round', 10);
      const particlesPerEdge = toCount(row['ParticlesPerEdge'], 4, 2, 'round', 2);
      const borderParticleCount = particlesPerEdge * sides
      const totalParticleCount  = borderParticleCount + interiorParticleCount

      const colorHex = row['Color'] || '#FF6B6B';
      
      // Infer scope level from culture name or default to local
      // Read scope directly from CSV column
      const scopeLevel = (row['Scope'] || 'local').toLowerCase().trim();
      scopeSet.add(scopeLevel);
      
      // Parse kinships (peer relationships)
      const kinships = kinshipsText
        .split(',')
        .map(k => k.trim())
        .filter(k => k && k !== 'Culture');
      
      // Parse affiliations (hierarchical relationships)
      const affiliations = affiliationsText
        .split(',')
        .map(a => a.trim())
        .filter(a => a && a !== 'Culture');
      
      // Use precomputed size based on sides (larger polygons = larger cultures)
      const size = 150 + (sides - 3) * 20; // Base 150, +20 per side above triangle
      
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
        values: [], // Not used in new format
        colors: [colorHex],
        kinships,
        affiliations,
        sides,
        knowledgebase,
        openness,
        language,
        size,
        frequencies: [2000], // Default frequency
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
        layer: 0,
        // Store precomputed particle counts
        interiorParticleCount,
        particlesPerEdge,
        borderParticleCount,
        totalParticleCount,
        // Store color directly (no hue conversion needed)
        colorHex,
        originalHue: null // Will be set from colorHex
      };
      
      placedCultures.push(culture);
      processed.push(culture);
    });

    const mergedCultures = processed; // No merging needed with clean data
    
    // Convert HEX colors to HSL and extract hue for each culture
    mergedCultures.forEach((culture) => {
      const hex = culture.colorHex;
      const hue = hexToHue(hex);
      culture.originalHue = hue;
    });
    
    // VALIDATE AFFILIATIONS: Ensure parents are at least 1 scope level higher
    const scopeHierarchy = ['family', 'local', 'regional', 'national', 'global'];

    mergedCultures.forEach(culture => {
      if (culture.affiliations.length > 0) {
        // Filter affiliations to only keep valid parents (1+ scope levels higher)
        const validAffiliations = culture.affiliations.filter(affiliationName => {
          const parentCulture = mergedCultures.find(c => c.name === affiliationName);
          
          if (!parentCulture) {
            console.warn(`Parent "${affiliationName}" not found for culture "${culture.name}"`);
            return false; // Parent doesn't exist in dataset
          }
          
          const childScopeIndex = scopeHierarchy.indexOf(culture.scopeLevel);
          const parentScopeIndex = scopeHierarchy.indexOf(parentCulture.scopeLevel);
          
          if (childScopeIndex === -1 || parentScopeIndex === -1) {
            console.warn(`Invalid scope level for "${culture.name}" or "${affiliationName}"`);
            return false; // Invalid scope levels
          }
          
          // Parent must be at least 1 level higher (lower index = higher scope)
          if (parentScopeIndex <= childScopeIndex) {
            console.warn(`Invalid affiliation: "${culture.name}" (${culture.scopeLevel}) cannot have parent "${affiliationName}" (${parentCulture.scopeLevel}) - parent must be at least 1 scope level higher`);
            return false;
          }
          
          return true; // Valid parent
        });
        
        // Update culture with only valid affiliations
        culture.affiliations = validAffiliations;
      }
    });
    
    // Set available scope levels
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

  // Initialize particles using precomputed counts
  const initializeParticles = (culturesData) => {
    const newParticles = [];
    
    culturesData.forEach((culture, cultureIndex) => {
      // Skip parent groups
      if (culture.isParentGroup) return;
      
      // Use precomputed particle counts from processor
      const interiorParticleCount = culture.interiorParticleCount;
      const borderParticleCount = culture.borderParticleCount;
      const totalParticleCount = culture.totalParticleCount;
      
      // Use culture's hue from color
      const unifiedHue = culture.originalHue;
      
      // Interior particles
      for (let i = 0; i < interiorParticleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (culture.size / 2 - 20);
        
        const saturation = 80 + Math.random() * 15;
        const lightness = 55 + Math.random() * 10;
        
        newParticles.push({
          cultureId: culture.id,
          homeCultureId: culture.id,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          color: `hsl(${unifiedHue}, ${saturation}%, ${lightness}%)`,
          originalColor: `hsl(${unifiedHue}, ${saturation}%, ${lightness}%)`,
          size: (culture.language * 0.6) + Math.random() * 2, // Language 1-5 → base 0.6-3.0, +0-2 variance
          wavePhase: Math.random() * Math.PI * 2,
          state: 'contained',
          targetCultureId: null,
          flowPartner: null,
          flowProgress: 0,
          baseSpeed: 0.3 + Math.random() * 0.3,
          activationDelay: 0,
          activationStartTime: 0,
          isBorderParticle: false,
          borderEdgeIndex: -1,
          borderEdgeT: 0,
          borderFloatPhase: Math.random() * Math.PI * 2,
          lastSwapTime: 0
        });
      }
      
      // Border particles
      for (let i = 0; i < borderParticleCount; i++) {
        const edgeProgress = i / borderParticleCount;
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
        
        const x = x1 + (x2 - x1) * edgeT;
        const y = y1 + (y2 - y1) * edgeT;
        
        const saturation = 80 + Math.random() * 15;
        const lightness = 55 + Math.random() * 10;
        const colorStr = `hsl(${unifiedHue}, ${saturation}%, ${lightness}%)`;
        
        newParticles.push({
          cultureId: culture.id,
          homeCultureId: culture.id,
          x: x,
          y: y,
          vx: 0,
          vy: 0,
          color: colorStr,
          originalColor: colorStr,
          size: (culture.language * 0.6) + Math.random() * 2,
          wavePhase: Math.random() * Math.PI * 2,
          state: 'contained',
          targetCultureId: null,
          flowPartner: null,
          flowProgress: 0,
          baseSpeed: 0,
          activationDelay: 0,
          activationStartTime: 0,
          isBorderParticle: true,
          borderEdgeIndex: edgeIndex,
          borderEdgeT: edgeT,
          borderFloatPhase: Math.random() * Math.PI * 2,
          lastSwapTime: 0
        });
      }
    });
    
    particlesRef.current = newParticles;
  };

  // Reset border particles for all cultures
  const resetAllBorderParticles = () => {
    culturesDataRef.current.forEach((culture) => {
      if (culture.isParentGroup) return;
      
      // Remove old border particles for this culture
      particlesRef.current = particlesRef.current.filter(p => 
        !(p.homeCultureId === culture.id && p.isBorderParticle)
      );
      
      // Use the culture's original hue
      const cultureHue = culture.originalHue !== undefined ? culture.originalHue : Math.random() * 360;
      
      // Create fresh border particles
      const borderParticleCount = culture.borderParticleCount || (culture.sides * 4);
      
      for (let i = 0; i < borderParticleCount; i++) {
        const edgeProgress = i / borderParticleCount;
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
        
        const x = x1 + (x2 - x1) * edgeT;
        const y = y1 + (y2 - y1) * edgeT;
        
        const saturation = 80 + Math.random() * 15;
        const lightness = 55 + Math.random() * 10;
        const colorStr = `hsl(${cultureHue}, ${saturation}%, ${lightness}%)`;
        
        particlesRef.current.push({
          cultureId: culture.id,
          homeCultureId: culture.id,
          x: x,
          y: y,
          vx: 0,
          vy: 0,
          color: colorStr,
          originalColor: colorStr, // Border particles keep their original color forever
          size: (culture.language * 0.6) + Math.random() * 2, // Language 1-5 → base 0.6-3.0, +0-2 variance
          wavePhase: Math.random() * Math.PI * 2,
          state: 'contained',
          targetCultureId: null,
          flowPartner: null,
          flowProgress: 0,
          baseSpeed: 0,
          activationDelay: 0,
          activationStartTime: 0,
          isBorderParticle: true,
          borderEdgeIndex: edgeIndex,
          borderEdgeT: edgeT,
          borderFloatPhase: Math.random() * Math.PI * 2,
          lastSwapTime: 0
        });
      }
    });
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
    // PRESERVE PARTICLES - just reset their states, DON'T rebalance counts
    newCultures.forEach(culture => {
      const cultureParticles = particlesRef.current.filter(p => p.homeCultureId === culture.id);
      
      cultureParticles.forEach((particle) => {
        // Just reset states, KEEP border/interior designation intact
        particle.cultureId = particle.homeCultureId;
        particle.state = 'contained';
        particle.targetCultureId = null;
        particle.flowPartner = null;
        particle.activationDelay = 0;
        particle.activationStartTime = 0;
        
        // Reset velocities based on particle type
        if (particle.isBorderParticle) {
          particle.vx = 0;
          particle.vy = 0;
        } else {
          particle.vx = (Math.random() - 0.5) * 0.3;
          particle.vy = (Math.random() - 0.5) * 0.3;
        }
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
    
    // Close panel immediately
    setPanelAnimationState('closing');
    setTimeout(() => setPanelAnimationState('closed'), 250);
    
    const focusedCultureId = selectedCulture?.id;
    
    // Step 1: Complete pending color exchanges and start visible return animation
    // Cultures stay in focused positions while particles return
    deactivateParticleFlow();
    
    // Step 2: After particles have returned home (1.5s), NOW shrink cultures
    setTimeout(() => {
      culturesDataRef.current = culturesDataRef.current.map(c => ({
        ...c,
        targetX: null,
        targetY: null,
        targetScale: 1,
        targetOpacity: 0.5,
        layer: 0
      }));
      setCultures([...culturesDataRef.current]);
    }, 1500);
    
    // Step 3: Reset all border particles after cultures shrink (2s)
    setTimeout(() => {
      resetAllBorderParticles();
    }, 2000);
    
    // Step 4: After cultures shrink, start fading out (2.5s)
    setTimeout(() => {
      targetFadeRef.current = 1; // Trigger fade to black
    }, 2500);
    
    // Step 5: At peak fade (3s), randomize positions (hidden)
    setTimeout(() => {
      setSelectedCulture(null);
      randomizeCulturePositions(focusedCultureId);
    }, 3000);
    
    // Step 6: After randomization, fade back in (3.5s)
    setTimeout(() => {
      targetFadeRef.current = 0; // Trigger fade from black
    }, 3500);
    
    // Step 7: Clear exiting state after fade-in completes (4s)
    setTimeout(() => {
      setIsExiting(false);
    }, 4000);
  };

  // Handle culture click
  const handleCultureClick = (culture) => {
    if (isTransitioning) return;
    
    setIsTransitioning(true);
    
    // If already in focus mode, complete exchanges and show return animation first
    if (selectedCulture) {
      // Close current panel first
      setPanelAnimationState('closing');
      
      deactivateParticleFlow();
      
      // Wait for panel to close, then switch focus
      setTimeout(() => {
        setPanelAnimationState('closed');
        setTimeout(() => {
          proceedWithFocus(culture);
        }, 800);
      }, 250);
    } else {
      // Not in focus mode, proceed immediately
      proceedWithFocus(culture);
    }
  };
  
  // Proceed with focusing on a culture (extracted for reuse)
  const proceedWithFocus = (culture) => {
    setSelectedCulture(culture);
    
    // Reset border particles before entering focus mode
    resetAllBorderParticles();
    
    const canvas = canvasRef.current;
    const centerX = culture.x;
    const centerY = culture.y;
    
    cameraRef.current = {
      x: centerX - canvas.width / 2,
      y: centerY - canvas.height / 2,
      zoom: 1
    };
    setCamera({ ...cameraRef.current });
    
    // Find connected cultures using EXACT matching to avoid false positives
    const connectedCultures = [];
    culturesDataRef.current.forEach(c => {
      if (c.id === culture.id) return;
      
      // Normalize names for comparison
      const cultureName = c.name.toLowerCase().trim();
      
      // Check if this culture exactly matches any kinship name
      const isKin = culture.kinships.some(k => {
        const kinshipName = k.toLowerCase().trim();
        
        // Exact match (prevents "Parents" from matching "Plant Parents")
        return cultureName === kinshipName || kinshipName === culture.name.toLowerCase().trim();
      });
      
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
          // Distribute connected cultures evenly around a circle
          // If more kinships than sides, use full circular distribution
          const totalConnected = connectedCultures.length;
          const angleStep = (Math.PI * 2) / totalConnected;
          const angle = culture.rotation + angleStep * kinIndex;
          
          // Calculate distance based on sizes
          const focusedRadius = (culture.size * 2) / 2;
          const connectedRadius = (c.size * 1.2) / 2;
          const baseSpacing = 120; // Increased spacing
          
          // Add extra spacing if many kinships to prevent crowding
          const crowdingFactor = Math.max(1, totalConnected / 8);
          const spacing = baseSpacing * crowdingFactor;
          
          const distance = focusedRadius + connectedRadius + spacing;
          
          const targetX = centerX + Math.cos(angle) * distance;
          const targetY = centerY + Math.sin(angle) * distance;
          
          // Calculate rotation to align edges
          // The focused edge direction at this angle
          const focusedEdgeDirection = angle + Math.PI / 2;
          
          // We want the connected culture's edge to be parallel but facing opposite
          const targetEdgeDirection = focusedEdgeDirection + Math.PI;
          
          // For the connected polygon, calculate required rotation
          const targetRotation = targetEdgeDirection - Math.PI / 2 - Math.PI / c.sides;
          
          return {
            ...c,
            targetX: targetX,
            targetY: targetY,
            rotation: targetRotation,
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

    // Trigger panel opening animation
    setPanelAnimationState('opening');
    setTimeout(() => {
      setPanelAnimationState('open');
    }, 400);

    setTimeout(() => {
      setIsTransitioning(false);
    }, 800);
  };

  // Activate particle flow between focused culture and connected cultures
  const activateParticleFlow = (focusedId, connectedIds) => {
    if (connectedIds.length === 0) return;
    
    // Get all interior particles from focused culture
    const focusedInteriorParticles = particlesRef.current.filter(
      p => p.homeCultureId === focusedId && !p.isBorderParticle
    );
    
    // Calculate exchange: 10% of focused interior particles, divided equally among kinships
    const totalToExchange = Math.floor(focusedInteriorParticles.length * 0.20);
    const perKinship = Math.floor(totalToExchange / connectedIds.length);
    
    // Track how many particles assigned to each kinship for exchange
    const exchangeCount = {};
    connectedIds.forEach(id => exchangeCount[id] = 0);
    
    // Also calculate reverse exchange: each connected culture exchanges 2% to focused
    // Also calculate reverse exchange: each connected culture exchanges (20/n)% to focused
    // Where n = number of connected cultures
    const reverseExchangePercentage = 0.20 / connectedIds.length;
    const reverseExchangeCount = {};
    connectedIds.forEach(id => {
      const connectedInteriorParticles = particlesRef.current.filter(
        p => p.homeCultureId === id && !p.isBorderParticle
      );
      reverseExchangeCount[id] = Math.floor(connectedInteriorParticles.length * reverseExchangePercentage);
    });
    const reverseExchangeUsed = {};
    connectedIds.forEach(id => reverseExchangeUsed[id] = 0);
    
    particlesRef.current = particlesRef.current.map(particle => {
      const isInFocused = particle.homeCultureId === focusedId;
      const isInConnected = connectedIds.includes(particle.homeCultureId);
      
      // Border particles NEVER participate in flows
      if (particle.isBorderParticle) {
        return particle;
      }
      
      // 50% of INTERIOR particles from focused culture will flow
      if (isInFocused && Math.random() < 0.5) {
        const targetId = connectedIds[Math.floor(Math.random() * connectedIds.length)];
        
        // Determine if this particle should exchange colors
        // Assign exchanges evenly: perKinship particles to each connected culture
        const willExchange = exchangeCount[targetId] < perKinship;
        if (willExchange) {
          exchangeCount[targetId]++;
        }
        
        return {
          ...particle,
          state: 'activating',
          targetCultureId: targetId,
          flowPartner: focusedId,
          flowProgress: 0,
          activationDelay: Math.random() * 2000,
          activationStartTime: Date.now(),
          baseSpeed: 0.3 + Math.random() * 0.3,
          willExchange: willExchange, // Mark whether this particle will swap colors
          exchangeTargetId: willExchange ? targetId : null // Store target for later exchange
        };
      }
      
      // 10% of INTERIOR particles from connected cultures will flow
      // Some will exchange colors back to focused culture
      if (isInConnected && Math.random() < 0.1) {
        const sourceId = particle.homeCultureId;
        const willExchange = reverseExchangeUsed[sourceId] < reverseExchangeCount[sourceId];
        if (willExchange) {
          reverseExchangeUsed[sourceId]++;
        }
        
        return {
          ...particle,
          state: 'activating',
          targetCultureId: focusedId,
          flowPartner: particle.homeCultureId,
          flowProgress: 0,
          activationDelay: Math.random() * 2000,
          activationStartTime: Date.now(),
          baseSpeed: 0.3 + 0.3 * 0.3,
          willExchange: willExchange, // Some particles from connected will also swap colors
          exchangeTargetId: willExchange ? focusedId : null // Store target for later exchange
        };
      }
      
      return particle;
    });
  };

  // Deactivate particle flow (return all to contained state)
  const deactivateParticleFlow = () => {
    particlesRef.current = particlesRef.current.map(particle => {
      // Border particles should ALWAYS stay contained - force reset if needed
      if (particle.isBorderParticle) {
        return {
          ...particle,
          state: 'contained',
          targetCultureId: null,
          flowPartner: null,
          activationDelay: 0,
          activationStartTime: 0,
          willExchange: undefined,
          exchangeTargetId: undefined
        };
      }
      
      // CRITICAL: Preserve current color for ALL particles
      // If particle is marked for exchange and hasn't swapped yet, do it now
      let finalColor = particle.color; // Always start with current color

      // Use exchangeTargetId if available (more reliable), fallback to targetCultureId
      const exchangeTarget = particle.exchangeTargetId || (particle.willExchange ? particle.targetCultureId : null);

      if (particle.willExchange === true && exchangeTarget) {
        const targetCulture = culturesDataRef.current.find(c => c.id === exchangeTarget);
        if (targetCulture && targetCulture.originalHue !== undefined) {
          // Complete the color exchange - calculate new color
          const saturation = 80 + Math.random() * 15;
          const lightness = 55 + Math.random() * 10;
          finalColor = `hsl(${targetCulture.originalHue}, ${saturation}%, ${lightness}%)`;
        }
      }
      
      // If particle is away from home, make it visibly return
      if (particle.state === 'flowing' || particle.state === 'activating') {
        return {
          ...particle,
          color: finalColor, // Preserve/apply color
          state: 'returning',
          cultureId: particle.homeCultureId,
          targetCultureId: particle.homeCultureId,
          flowPartner: null,
          willExchange: undefined,
          exchangeTargetId: undefined, // ← ADD THIS
          baseSpeed: 0.5
        };
      }
      
      // If already returning or contained, keep current state but preserve color
      if (particle.state === 'returning') {
        return {
          ...particle,
          color: finalColor, // Preserve/apply color
          targetCultureId: particle.homeCultureId,
          flowPartner: null,
          willExchange: undefined,
          exchangeTargetId: undefined, // ← ADD THIS
          baseSpeed: 0.5
        };
      }
      
      // Already contained - preserve everything including color
      return {
        ...particle,
        color: finalColor, // Preserve current color!
        state: 'contained',
        cultureId: particle.homeCultureId,
        targetCultureId: null,
        flowPartner: null,
        activationDelay: 0,
        activationStartTime: 0,
        willExchange: undefined,
        exchangeTargetId: undefined, // ← ADD THIS
        baseSpeed: undefined
      };
    });
  };

  // Apply force-directed layout - WITH COLLISION AVOIDANCE
  const applyForces = () => {
    const attraction = 0.00001;
    const damping = 0.96;
    const brownianForce = 0.08;
    const homeSpringStrength = 0.003;
    const homeRadius = 300;
    const velocityThreshold = 0.02;
    const forceThreshold = 0.01;
    const collisionRepulsion = 0.5; // Strength of repulsion between overlapping shapes
    
    culturesDataRef.current.forEach((c1) => {
      if (c1.targetX !== null) return;
      if (c1.isParentGroup) return; // Parent groups don't move via physics
      
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
      
      // COLLISION DETECTION AND REPULSION
      culturesDataRef.current.forEach((c2) => {
        if (c1.id === c2.id || c2.targetX !== null) return;
        
        // Skip collision between children and their parent group
        if (c2.isParentGroup && c1.affiliations && c1.affiliations.includes(c2.name)) {
          return; // Child should not collide with its parent
        }
        if (c1.isParentGroup && c2.affiliations && c2.affiliations.includes(c1.name)) {
          return; // Parent should not collide with its child
        }
        
        // Skip collision between children of the same parent
        if (!c1.isParentGroup && !c2.isParentGroup && c1.affiliations && c2.affiliations) {
          const sharedParent = c1.affiliations.some(a => c2.affiliations.includes(a));
          if (sharedParent) {
            return; // Siblings inside same parent should not collide with each other
          }
        }
        
        const dx = c1.x - c2.x;
        const dy = c1.y - c2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Minimum distance = sum of radii + padding
        const minDist = (c1.size * c1.scale) / 2 + (c2.size * c2.scale) / 2 + 100;
        
        if (dist < minDist && dist > 0) {
          // Shapes are overlapping - apply repulsion force
          const overlap = minDist - dist;
          const repulsionForce = collisionRepulsion * overlap;
          
          fx += (dx / dist) * repulsionForce;
          fy += (dy / dist) * repulsionForce;
        }
      });
      
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
      
      // If this culture has a parent, constrain it to parent bounds BEFORE world boundary check
      if (c1.affiliations && c1.affiliations.length > 0) {
        const parentName = c1.affiliations[0];
        const parent = culturesDataRef.current.find(p => p.isParentGroup && p.name === parentName);
        
        if (parent) {
          const dx = c1.x - parent.x;
          const dy = c1.y - parent.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = parent.size / 2 - c1.size * c1.scale / 2 - 80; // 80px padding from parent edge
          
          if (dist > maxDist && maxDist > 0) {
            // Push child back inside parent
            const angle = Math.atan2(dy, dx);
            c1.x = parent.x + Math.cos(angle) * maxDist;
            c1.y = parent.y + Math.sin(angle) * maxDist;
            
            // Dampen velocity when hitting parent boundary
            c1.vx *= 0.5;
            c1.vy *= 0.5;
          }
        }
      }
      
      // World boundary check (only for cultures without parents)
      if (!c1.affiliations || c1.affiliations.length === 0) {
        const margin = 800;
        c1.x = Math.max(margin, Math.min(WORLD_WIDTH - margin, c1.x));
        c1.y = Math.max(margin, Math.min(WORLD_HEIGHT - margin, c1.y));
      }
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

  // Enforce soft polygon boundary with smooth repulsion
  const enforcePolygonBoundary = (particle, culture) => {
    const radius = (culture.size * culture.scale) / 2;
    const angleStep = (Math.PI * 2) / culture.sides;
    const apothem = radius * Math.cos(Math.PI / culture.sides);
    const rotation = culture.rotation + culture.morphOffset;
    
    // Soft boundary zone - start repelling before hitting edge
    const softZoneWidth = 15;
    const hardBoundary = apothem - 5; // Hard limit
    
    // Check each edge and apply soft repulsion
    for (let i = 0; i < culture.sides; i++) {
      // Edge midpoint angle (this is where the normal points outward from)
      const edgeMidAngle = rotation + angleStep * (i + 0.5);
      const normalAngle = edgeMidAngle;
      
      // Distance from particle to edge along normal
      const distToEdge = particle.x * Math.cos(normalAngle) + particle.y * Math.sin(normalAngle);
      
      // Soft repulsion zone
      if (distToEdge > hardBoundary - softZoneWidth) {
        const distanceIntoZone = distToEdge - (hardBoundary - softZoneWidth);
        const repulsionStrength = (distanceIntoZone / softZoneWidth) * 0.15;
        
        // Apply smooth repulsion force away from edge
        particle.vx -= Math.cos(normalAngle) * repulsionStrength;
        particle.vy -= Math.sin(normalAngle) * repulsionStrength;
      }
      
      // Hard boundary - prevent crossing
      if (distToEdge > hardBoundary) {
        const overflow = distToEdge - hardBoundary;
        particle.x -= Math.cos(normalAngle) * overflow;
        particle.y -= Math.sin(normalAngle) * overflow;
        
        // Soft bounce - reduce velocity perpendicular to edge
        const normalVel = particle.vx * Math.cos(normalAngle) + particle.vy * Math.sin(normalAngle);
        if (normalVel > 0) {
          particle.vx -= 1.5 * normalVel * Math.cos(normalAngle);
          particle.vy -= 1.5 * normalVel * Math.sin(normalAngle);
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
    
    // Border particle count: scale with sides to keep shape clear
    // Base: 4 particles per edge, then add more based on closedness (low openness)
    // Use precomputed border particle count from culture
    const borderParticleCount = culture.borderParticleCount || (sides * 4);
    const particlesPerEdge = Math.ceil(borderParticleCount / sides);
    
    // Get a sample particle color from this culture's particles
    const cultureParticles = particlesRef.current.filter(p => p.homeCultureId === culture.id);
    const sampleColor = cultureParticles.length > 0 ? cultureParticles[0].color : 'rgba(255,255,255,0.8)';
    
    const radius = (size * scale) / 2;
    const angleStep = (Math.PI * 2) / sides;
    
    ctx.save();
    ctx.globalAlpha = renderOpacity * 0.9;
    
    // Distribute particles evenly along all edges
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
      if (!culture) return;
      
      // Skip ALL particle updates (not just rendering) for invisible cultures
      // This prevents particles from accumulating weird positions/velocities when filtered out
      if (culture.opacity < 0.15) return;
      
      // Boost opacity to 100% if hovered (same as focused mode)
      const renderOpacity = (hoveredCultureRef.current && hoveredCultureRef.current.id === culture.id) ? 1.0 : culture.opacity;
      
      // Handle different particle states
      if (particle.state === 'contained') {
        // Skip border particles in default mode - they're not rendered or simulated
        if (particle.isBorderParticle && visualMode === 'default') {
          return; // Don't process border particles in default mode
        }
        
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
          // Interior particle behavior (same in both modes)
          
          // Check if this particle belongs to a parent group
          const isParentParticle = culture.isParentGroup;
          
          // Stronger Brownian motion for parent groups to maintain visual volume
          const brownianForce = isParentParticle ? 0.15 : 0.08;
          particle.vx += (Math.random() - 0.5) * brownianForce;
          particle.vy += (Math.random() - 0.5) * brownianForce;
          
          // Center-seeking force with radial pressure balance
          const distFromCenter = Math.sqrt(particle.x ** 2 + particle.y ** 2);
          
          if (isParentParticle) {
            // PARENT GROUPS: Fill entire volume evenly with gentle edge containment
            const maxRadius = (culture.size * culture.scale) / 2 - 40;
            
            // Only apply containment force near the edges (beyond 80% of radius)
            if (distFromCenter > maxRadius * 0.8) {
              // Too close to edge - gentle inward pull
              const inwardForce = 0.002;
              const radiusDiff = distFromCenter - (maxRadius * 0.8);
              const angleToCenter = Math.atan2(-particle.y, -particle.x);
              particle.vx += Math.cos(angleToCenter) * inwardForce * (radiusDiff / 20);
              particle.vy += Math.sin(angleToCenter) * inwardForce * (radiusDiff / 20);
            }
            // No center-seeking or outward forces - let Brownian motion fill the space naturally
          } else {
            // REGULAR CULTURES: Balanced distribution throughout shape
            const maxRadius = (culture.size * culture.scale) / 2 - 40;
            
            if (distFromCenter < maxRadius * 0.3) {
              // Very close to center - gentle outward pressure to fill space
              const outwardForce = 0.001;
              const radiusDiff = (maxRadius * 0.3) - distFromCenter;
              const angleFromCenter = Math.atan2(particle.y, particle.x);
              particle.vx += Math.cos(angleFromCenter) * outwardForce * (radiusDiff / 100);
              particle.vy += Math.sin(angleFromCenter) * outwardForce * (radiusDiff / 100);
            } else if (distFromCenter > maxRadius * 0.7) {
              // Too close to edge - gentle inward pull
              const inwardForce = 0.002;
              const radiusDiff = distFromCenter - (maxRadius * 0.7);
              const angleToCenter = Math.atan2(-particle.y, -particle.x);
              particle.vx += Math.cos(angleToCenter) * inwardForce * (radiusDiff / 100);
              particle.vy += Math.sin(angleToCenter) * inwardForce * (radiusDiff / 100);
            }
            // Particles in the middle zone (30%-70% of radius) move freely
          }
          
          // Gentle damping for smooth motion
          const damping = 0.97;
          particle.vx *= damping;
          particle.vy *= damping;
          
          // Limit maximum speed
          const maxSpeed = 0.8;
          const speed = Math.sqrt(particle.vx ** 2 + particle.vy ** 2);
          if (speed > maxSpeed) {
            particle.vx = (particle.vx / speed) * maxSpeed;
            particle.vy = (particle.vy / speed) * maxSpeed;
          }
          
          // Update position
          particle.x += particle.vx;
          particle.y += particle.vy;
          
          // Enforce soft polygon boundary with smooth repulsion
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
          // Still waiting - behave as contained with smooth random walk
          const brownianForce = 0.08;
          particle.vx += (Math.random() - 0.5) * brownianForce;
          particle.vy += (Math.random() - 0.5) * brownianForce;
          
          // Gentle damping
          particle.vx *= 0.97;
          particle.vy *= 0.97;
          
          // Limit speed
          const maxSpeed = 0.8;
          const speed = Math.sqrt(particle.vx ** 2 + particle.vy ** 2);
          if (speed > maxSpeed) {
            particle.vx = (particle.vx / speed) * maxSpeed;
            particle.vy = (particle.vy / speed) * maxSpeed;
          }
          
          // Update position
          particle.x += particle.vx;
          particle.y += particle.vy;
          
          // Enforce boundary
          enforcePolygonBoundary(particle, culture);
          
          const worldX = culture.x + particle.x;
          const worldY = culture.y + particle.y;
          
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
          // Arrived at target culture - COLOR EXCHANGE ONLY
          if (particle.state === 'flowing') {
            // Check if this particle was pre-marked for exchange
            const shouldExchange = particle.willExchange === true;
            
            if (shouldExchange) {
              // COLOR SWAP: Get the target culture's ORIGINAL color
              const targetCulture = culturesDataRef.current.find(c => c.id === particle.targetCultureId);
              if (targetCulture && targetCulture.originalHue !== undefined) {
                // Use the target culture's original hue to generate a new color
                const saturation = 80 + Math.random() * 15; // 80-95%
                const lightness = 55 + Math.random() * 10; // 55-65%
                particle.color = `hsl(${targetCulture.originalHue}, ${saturation}%, ${lightness}%)`;
              }
              
              // Return home with new color
              particle.state = 'returning';
              particle.targetCultureId = particle.homeCultureId;
              particle.flowPartner = null;
              particle.willExchange = undefined;
              
            } else {
              // Temporary flow - cycle back (no color change)
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
            particle.willExchange = undefined;
          }
        }
      }
    });
  };

  // Animation loop
  useEffect(() => {
    // Only run animation in Explore mode
    if (mode !== 'explore') {
      // Stop animation if switching away from explore
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }
    
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
        
        // Parent groups should maintain their scale at 1, regular cultures smooth to target
        if (c.isParentGroup) {
          newScale = 1; // Force parent groups to always have scale = 1
        } else {
          newScale += (c.targetScale - c.scale) * 0.1;
        }
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
        
        // Define scope hierarchy for comparison
        const scopeHierarchy = ['family', 'local', 'regional', 'national', 'global'];
        const currentScopeIndex = scopeHierarchy.indexOf(selectedScope);
        
        // Group children by their parent affiliation
        const parentGroups = new Map();
        visibleCultures.forEach(culture => {
          if (culture.affiliations && culture.affiliations.length > 0) {
            const parentName = culture.affiliations[0];
            
            // Find the actual parent culture
            const allCultures = culturesDataRef.current.filter(c => !c.isParentGroup);
            const parentCulture = allCultures.find(c => c.name === parentName);
            
            if (!parentCulture) {
              return; // Parent doesn't exist in dataset
            }
            
            // Check if parent is at least 1 level higher in the hierarchy
            const childScopeIndex = scopeHierarchy.indexOf(culture.scopeLevel);
            const parentScopeIndex = scopeHierarchy.indexOf(parentCulture.scopeLevel);
            
            // Parent must be at higher scope (lower index = broader/higher scope)
            // This allows parents that are 1+ levels higher
            if (parentScopeIndex >= 0 && childScopeIndex >= 0 && parentScopeIndex > childScopeIndex) {
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
              frequencies: [],
              originalHue: parentHue // Store original hue
            };
            
            culturesDataRef.current.push(parent);
            existingParents.push(parent); // Track for next parent group's overlap check
            
            // Create particles with SAME hue as original parent culture
            const parentParticleCount = 80;
            
            for (let i = 0; i < parentParticleCount; i++) {
              const angle = Math.random() * Math.PI * 2;
              const radius = Math.random() * (parent.size / 2 - 20);
              
              const colorStr = `hsl(${parentHue}, 65%, 60%)`;
              
              particlesRef.current.push({
                cultureId: parent.id,
                homeCultureId: parent.id,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                vx: (Math.random() - 0.5) * 0.2,
                vy: (Math.random() - 0.5) * 0.2,
                color: colorStr,
                originalColor: colorStr, // Store original color
                size: ((originalParent?.language || 3) * 0.6) + Math.random() * 2,
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
            
            // Maintain parent size - don't let it shrink
            const baseSize = 800;
            const sizePerChild = 300;
            parent.size = Math.max(parent.size, baseSize + (children.length * sizePerChild));
            
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
      
      ctx.font = 'bold 16px IAAB3Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      sorted.forEach(culture => {
        const isHovered = hoveredCultureRef.current && hoveredCultureRef.current.id === culture.id;
        const renderOpacity = isHovered ? 1.0 : culture.opacity;
        
        // Show name for regular cultures only (parent groups use cursor tooltip)
        if (!culture.isParentGroup && (renderOpacity > 0.6 || isHovered)) {
          const fontSize = culture.layer === 3 ? 22 : 16;
          ctx.font = `bold ${fontSize}px IAAB3Mono, monospace`;
          
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
  }, [cultures.length, selectedCulture, isExiting, visualMode, selectedScope, mode]);

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
      // Check if we clicked on background while panel is open
      if (selectedCulture && panelAnimationState === 'open') {
        // Close panel only if not clicking on the panel itself
        const panelElement = document.querySelector('.culture-details-panel');
        if (panelElement && !panelElement.contains(event.target)) {
          handleExitFocus();
        }
      } else {
        setIsDragging(true);
        isDraggingRef.current = true;
        setLastMousePos({ x: event.clientX, y: event.clientY });
      }
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
  // const handleZoomScopeChange = (newZoom) => {
  //   if (selectedCulture) return; // Don't change scope in focused mode
    
  //   const scopeHierarchy = ['all', 'global', 'national', 'regional', 'local'];
  //   const currentIndex = scopeHierarchy.indexOf(selectedScope);
    
  //   if (currentIndex === -1) return; // Invalid scope
    
  //   // Zoom threshold for scope change
  //   const zoomInThreshold = 2.0;   // 200% zoom = go to smaller/local scope
  //   const zoomOutThreshold = 0.5;  // 50% zoom = go to larger/global scope
    
  //   let newScopeIndex = -1;
    
  //   // Check if we've crossed the zoom-in threshold
  //   if (newZoom >= zoomInThreshold && currentIndex < scopeHierarchy.length - 1) {
  //     // Move to SMALLER scope (more local)
  //     newScopeIndex = currentIndex + 1;
  //   }
  //   // Check if we've crossed the zoom-out threshold
  //   else if (newZoom <= zoomOutThreshold && currentIndex > 0) {
  //     // Move to LARGER scope (more global)
  //     newScopeIndex = currentIndex - 1;
  //   }
    
  //   if (newScopeIndex !== -1) {
  //     const newScope = scopeHierarchy[newScopeIndex];
  //     setSelectedScope(newScope);
      
  //     // Find a random culture at the new scope level
  //     const culturesAtNewScope = culturesDataRef.current.filter(c => 
  //       !c.isParentGroup && (newScope === 'all' || c.scopeLevel === newScope)
  //     );
      
  //     const canvas = canvasRef.current;
  //     if (canvas && culturesAtNewScope.length > 0) {
  //       const randomCulture = culturesAtNewScope[Math.floor(Math.random() * culturesAtNewScope.length)];
        
  //       // Move camera to the random culture
  //       cameraRef.current = {
  //         x: randomCulture.x - canvas.width / 2,
  //         y: randomCulture.y - canvas.height / 2,
  //         zoom: 1
  //       };
  //       setCamera({ ...cameraRef.current });
  //       setLastZoom(1);
  //     }
  //   }
    
  //   setLastZoom(newZoom);
  // };

  // Helper function to change scope
  const changeScope = (newScope) => {
    if (newScope === selectedScope) return; // No change
    
    setSelectedScope(newScope);
    
    // Move camera to random culture at new scope
    setTimeout(() => {
      const culturesAtNewScope = culturesDataRef.current.filter(c => 
        !c.isParentGroup && (newScope === 'all' || c.scopeLevel === newScope)
      );
      
      const canvas = canvasRef.current;
      if (canvas && culturesAtNewScope.length > 0) {
        const randomCulture = culturesAtNewScope[Math.floor(Math.random() * culturesAtNewScope.length)];
        cameraRef.current = {
          x: randomCulture.x - canvas.width / 2,
          y: randomCulture.y - canvas.height / 2,
          zoom: 1
        };
        setCamera({ ...cameraRef.current });
      }
    }, 50);
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

  // ==================== CURATE MODE FUNCTIONS ====================

  // Handle mode toggle
  const handleModeToggle = () => {
    const newMode = mode === 'explore' ? 'curate' : 'explore';
    setMode(newMode);
    
    // Clear temporary UI states
    setSearchQuery('');
    setShowSearchDropdown(false);
    setCurateSearchInput('');
    setShowSuggestionDropdown(false);
    setShowActivityPanel(false);
    setSelectedCuratedCulture(null);
    
    // If switching TO explore mode, force complete refresh
    if (newMode === 'explore') {
      const originalScope = selectedScope;
      
      // BRUTAL FIX STEP 1: Force canvas resize
      setTimeout(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (container && canvas) {
          canvas.width = container.clientWidth;
          canvas.height = container.clientHeight;
        }
        
        // BRUTAL FIX STEP 2: Cycle scope to force re-render
        setTimeout(() => {
          const tempScope = scopeLevels.includes('national') ? 'national' : (scopeLevels[1] || scopeLevels[0]);
          setSelectedScope(tempScope);
          
          // BRUTAL FIX STEP 3: Return to original scope
          setTimeout(() => {
            setSelectedScope(originalScope);
            
            // BRUTAL FIX STEP 4: Reset camera properly
            setTimeout(() => {
              const canvas = canvasRef.current;
              if (!canvas || culturesDataRef.current.length === 0) return;
              
              const visibleCultures = culturesDataRef.current.filter(c => !c.isParentGroup);
              if (visibleCultures.length > 0) {
                const randomCulture = visibleCultures[Math.floor(Math.random() * visibleCultures.length)];
                
                cameraRef.current = {
                  x: randomCulture.x - canvas.width / 2,
                  y: randomCulture.y - canvas.height / 2,
                  zoom: 1
                };
                setCamera({ ...cameraRef.current });
                // setLastZoom(1);
                
                // BRUTAL FIX STEP 5: Force one more render
                setCultures([...culturesDataRef.current]);
              }
            }, 100);
          }, 150);
        }, 100);
      }, 50);
    }
    
    // Curated activities and particles persist
  };

  // Handle view kinships button - switch to explore and focus on culture
  const handleViewKinships = (culture) => {
    // Close curate panel
    setShowActivityPanel(false);
    setSelectedCuratedCulture(null);
    
    // Switch to explore mode
    setMode('explore');
    
    // Wait for mode switch to complete, then focus on culture
    setTimeout(() => {
      handleCultureClick(culture);
    }, 200);
  };

  // Handle curate search input with trigger detection
  const handleCurateSearch = (input) => {
    setCurateSearchInput(input);
    
    if (!input.trim()) {
      setActiveSuggestions([]);
      setShowSuggestionDropdown(false);
      return;
    }
    
    // Filter cultures by search query (same as explore mode)
    const lowerQuery = input.toLowerCase();
    const results = culturesDataRef.current.filter(c => {
      if (c.isParentGroup) return false; // Exclude parent groups
      return c.name.toLowerCase().includes(lowerQuery);
    });
    
    setActiveSuggestions(results);
    setShowSuggestionDropdown(true);
  };

  // Handle suggestion click
  const handleSuggestionClick = (culture) => {
    setSelectedCuratedCulture(culture);
    setShowActivityPanel(true);
    setCurateSearchInput('');
    setShowSuggestionDropdown(false);
    setActiveSuggestions([]);
  };

  // Generate particles for the rotating shape visualization (mini version of culture)
  const generateShapeParticles = (culture) => {
    const particles = [];
    const shapeSize = 160;
    
    // Get culture color
    const cultureHue = culture.originalHue !== undefined ? culture.originalHue : Math.random() * 360;
    
    // Scale down precomputed counts for the small preview
    const interiorCount = Math.floor(culture.interiorParticleCount * 0.3); // 30% of original
    const scaledParticlesPerEdge = Math.max(3, Math.floor(culture.particlesPerEdge * 0.7)); // 70% of original
    const borderCount = culture.sides * scaledParticlesPerEdge;
    
    // Interior particles
    for (let i = 0; i < interiorCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * (shapeSize / 2 - 20);
      
      const saturation = 80 + Math.random() * 15;
      const lightness = 55 + Math.random() * 10;
      
      particles.push({
        id: `shape_interior_${culture.id}_${i}`,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        color: `hsl(${cultureHue}, ${saturation}%, ${lightness}%)`,
        size: (culture.language * 0.6) + Math.random() * 2, // Match explore mode sizing
        isBorder: false
      });
    }
    
    // Border particles
    for (let i = 0; i < borderCount; i++) {
      const edgeProgress = i / borderCount;
      const totalEdgeLength = culture.sides;
      const position = edgeProgress * totalEdgeLength;
      const edgeIndex = Math.floor(position);
      const edgeT = position - edgeIndex;
      
      const angleStep = (Math.PI * 2) / culture.sides;
      const angle1 = angleStep * edgeIndex - Math.PI / 2;
      const angle2 = angleStep * ((edgeIndex + 1) % culture.sides) - Math.PI / 2;
      const radius = shapeSize / 2 - 8;
      
      const x1 = Math.cos(angle1) * radius;
      const y1 = Math.sin(angle1) * radius;
      const x2 = Math.cos(angle2) * radius;
      const y2 = Math.sin(angle2) * radius;
      
      const x = x1 + (x2 - x1) * edgeT;
      const y = y1 + (y2 - y1) * edgeT;
      
      const saturation = 80 + Math.random() * 15;
      const lightness = 55 + Math.random() * 10;
      
      particles.push({
        id: `shape_border_${culture.id}_${i}`,
        x: x,
        y: y,
        vx: 0,
        vy: 0,
        color: `hsl(${cultureHue}, ${saturation}%, ${lightness}%)`,
        size: (culture.language * 0.6) + Math.random() * 2, // Match explore mode sizing
        isBorder: true,
        borderEdgeIndex: edgeIndex,
        borderEdgeT: edgeT,
        borderFloatPhase: Math.random() * Math.PI * 2
      });
    }
    
    return particles;
  };

  // Update shape particles animation
  const updateShapeParticles = (culture) => {
    const particles = shapeParticlesRef.current;
    const shapeSize = 160;
    
    particles.forEach(particle => {
      if (particle.isBorder) {
        // Border particle - float along edge
        const angleStep = (Math.PI * 2) / culture.sides;
        const angle1 = angleStep * particle.borderEdgeIndex - Math.PI / 2;
        const angle2 = angleStep * ((particle.borderEdgeIndex + 1) % culture.sides) - Math.PI / 2;
        const radius = shapeSize / 2 - 8;
        
        const x1 = Math.cos(angle1) * radius;
        const y1 = Math.sin(angle1) * radius;
        const x2 = Math.cos(angle2) * radius;
        const y2 = Math.sin(angle2) * radius;
        
        const baseX = x1 + (x2 - x1) * particle.borderEdgeT;
        const baseY = y1 + (y2 - y1) * particle.borderEdgeT;
        
        const edgeAngle = Math.atan2(y2 - y1, x2 - x1);
        const perpAngle = edgeAngle + Math.PI / 2;
        const floatAmount = Math.sin(Date.now() * 0.003 + particle.borderFloatPhase) * 3;
        
        particle.x = baseX + Math.cos(perpAngle) * floatAmount;
        particle.y = baseY + Math.sin(perpAngle) * floatAmount;
      } else {
        // Interior particle - brownian motion
        particle.vx += (Math.random() - 0.5) * 0.08;
        particle.vy += (Math.random() - 0.5) * 0.08;
        
        particle.vx *= 0.97;
        particle.vy *= 0.97;
        
        const maxSpeed = 0.8;
        const speed = Math.sqrt(particle.vx ** 2 + particle.vy ** 2);
        if (speed > maxSpeed) {
          particle.vx = (particle.vx / speed) * maxSpeed;
          particle.vy = (particle.vy / speed) * maxSpeed;
        }
        
        particle.x += particle.vx;
        particle.y += particle.vy;
        
        // ENFORCE POLYGON BOUNDARY (not just circular)
        const radius = shapeSize / 2;
        const angleStep = (Math.PI * 2) / culture.sides;
        const apothem = radius * Math.cos(Math.PI / culture.sides);
        const rotation = -Math.PI / 2; // Match the rotation used in border particles
        
        const softZoneWidth = 10;
        const hardBoundary = apothem - 5;
        
        // Check each edge and apply soft repulsion
        for (let i = 0; i < culture.sides; i++) {
          const edgeMidAngle = rotation + angleStep * (i + 0.5);
          const normalAngle = edgeMidAngle;
          
          const distToEdge = particle.x * Math.cos(normalAngle) + particle.y * Math.sin(normalAngle);
          
          // Soft repulsion zone
          if (distToEdge > hardBoundary - softZoneWidth) {
            const distanceIntoZone = distToEdge - (hardBoundary - softZoneWidth);
            const repulsionStrength = (distanceIntoZone / softZoneWidth) * 0.15;
            
            particle.vx -= Math.cos(normalAngle) * repulsionStrength;
            particle.vy -= Math.sin(normalAngle) * repulsionStrength;
          }
          
          // Hard boundary - prevent crossing
          if (distToEdge > hardBoundary) {
            const overflow = distToEdge - hardBoundary;
            particle.x -= Math.cos(normalAngle) * overflow;
            particle.y -= Math.sin(normalAngle) * overflow;
            
            const normalVel = particle.vx * Math.cos(normalAngle) + particle.vy * Math.sin(normalAngle);
            if (normalVel > 0) {
              particle.vx -= 1.5 * normalVel * Math.cos(normalAngle);
              particle.vy -= 1.5 * normalVel * Math.sin(normalAngle);
            }
          }
        }
      }
    });
    
    setShapeParticles([...particles]);
  };

  // Generate particles for a culture (curate mode)
  const generateParticles = (culture) => {
    // Use precomputed particle count, scaled down for curate mode
    const particleCount = Math.floor(culture.totalParticleCount / 2);
    const newParticles = [];
    
    // Get culture color from its hue
    const cultureHue = culture.originalHue !== undefined ? culture.originalHue : Math.random() * 360;
    
    for (let i = 0; i < particleCount; i++) {
      // Random position within boundary
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * (CURATE_BOUNDARY_RADIUS - 20);
      
      // Random velocity
      const speed = 0.5 + Math.random() * 1.5;
      const velocityAngle = Math.random() * Math.PI * 2;
      
      // Use culture's color with variation
      const saturation = 80 + Math.random() * 15;
      const lightness = 55 + Math.random() * 10;
      const color = `hsl(${cultureHue}, ${saturation}%, ${lightness}%)`;
      
      newParticles.push({
        id: `${culture.id}_${i}_${Date.now()}`,
        cultureId: culture.id,
        cultureName: culture.name,
        color: color,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: Math.cos(velocityAngle) * speed,
        vy: Math.sin(velocityAngle) * speed,
        radius: 4
      });
    }
    
    return newParticles;
  };

  // Handle curate button click
  const handleCurateCulture = (culture) => {
    // Check if already curated
    if (curatedActivities.find(c => c.id === culture.id)) {
      // Already curated, just close panel
      setShowActivityPanel(false);
      setSelectedCuratedCulture(null);
      return;
    }
    
    // Generate particles
    const newParticles = generateParticles(culture);
    
    // Add to curated cultures
    setCuratedActivities(prev => [...prev, culture]);
    
    // Add particles
    setCurateParticles(prev => [...prev, ...newParticles]);
    curateParticlesRef.current = [...curateParticlesRef.current, ...newParticles];
    
    // Close panel
    setShowActivityPanel(false);
    setSelectedCuratedCulture(null);
  };

  // Particle physics update loop
  const updateCurateParticles = () => {
    const particles = curateParticlesRef.current;
    
    particles.forEach(particle => {
      // Update position
      particle.x += particle.vx;
      particle.y += particle.vy;
      
      // Check boundary collision
      const distance = Math.sqrt(particle.x ** 2 + particle.y ** 2);
      const maxDistance = CURATE_BOUNDARY_RADIUS - particle.radius;
      
      if (distance > maxDistance) {
        // Normalize position vector
        const nx = particle.x / distance;
        const ny = particle.y / distance;
        
        // Reflect velocity
        const dot = particle.vx * nx + particle.vy * ny;
        particle.vx = particle.vx - 2 * dot * nx;
        particle.vy = particle.vy - 2 * dot * ny;
        
        // Reposition inside boundary
        particle.x = nx * maxDistance;
        particle.y = ny * maxDistance;
      }
    });
    
    setCurateParticles([...particles]);
  };

  // Handle particle click
  const handleCurateParticleClick = (particle) => {
    const culture = culturesDataRef.current.find(c => c.id === particle.cultureId);
    if (culture) {
      setSelectedCuratedCulture(culture);
      setShowActivityPanel(true);
    }
  };

  // Handle legend click
  const handleLegendClick = (culture) => {
    setSelectedCuratedCulture(culture);
    setShowActivityPanel(true);
  };

  // Handle clear curate
  const handleClearCurate = () => {
    setCurateParticles([]);
    curateParticlesRef.current = [];
    setCuratedActivities([]);
    setShowActivityPanel(false);
    setSelectedCuratedCulture(null);
    triggerGradientFeedback('clear-button');
  };

  // Gradient feedback animation trigger
  const triggerGradientFeedback = (elementId) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    // Add animation class
    element.classList.add('gradient-feedback-active');
    
    // Remove after animation completes
    setTimeout(() => {
      element.classList.remove('gradient-feedback-active');
    }, 600);
  };

  // Curate particle animation loop
  useEffect(() => {
    if (mode !== 'curate' || curateParticlesRef.current.length === 0) {
      if (curateAnimationRef.current) {
        cancelAnimationFrame(curateAnimationRef.current);
        curateAnimationRef.current = null;
      }
      return;
    }
    
    const animate = () => {
      updateCurateParticles();
      curateAnimationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (curateAnimationRef.current) {
        cancelAnimationFrame(curateAnimationRef.current);
      }
    };
  }, [mode, curateParticles.length]);

  // Shape particle animation loop
  useEffect(() => {
    if (!showActivityPanel || !selectedCuratedCulture) {
      // Stop animation when panel is closed
      if (shapeAnimationRef.current) {
        cancelAnimationFrame(shapeAnimationRef.current);
        shapeAnimationRef.current = null;
      }
      setShapeParticles([]);
      shapeParticlesRef.current = [];
      return;
    }
    
    // ALWAYS regenerate particles when culture changes (check by ID)
    const currentCultureId = selectedCuratedCulture.id;
    const needsRegeneration = shapeParticlesRef.current.length === 0 || 
                              !shapeParticlesRef.current[0] || 
                              shapeParticlesRef.current[0].id.includes('shape_') && 
                              !shapeParticlesRef.current[0].id.includes(`_${currentCultureId}_`);
    
    if (needsRegeneration) {
      const particles = generateShapeParticles(selectedCuratedCulture);
      shapeParticlesRef.current = particles;
      setShapeParticles(particles);
    }
    
    const animate = () => {
      if (selectedCuratedCulture) {
        updateShapeParticles(selectedCuratedCulture);
      }
      shapeAnimationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (shapeAnimationRef.current) {
        cancelAnimationFrame(shapeAnimationRef.current);
      }
    };
  }, [showActivityPanel, selectedCuratedCulture]);

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
  }, [cultures.length, mode]); // Added mode to dependencies

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event) => {
      // Toggle visual mode with 'b' or 'd' key
      if (event.key === 'b' || event.key === 'd' || event.key === 'B' || event.key === 'D') {
        setVisualMode(prev => prev === 'default' ? 'borderless' : 'default');
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Font face declaration
  const fontFaceStyles = `
    @font-face {
      font-family: 'IAAB3Mono';
      src: url('/IAAB3Mono.otf') format('opentype');
      font-weight: normal;
      font-style: normal;
    }
  `;

  // Gradient feedback animation styles
  const gradientAnimationStyles = `
    @keyframes panelRollOut {
      0% { 
        transform: scaleX(0);
        transform-origin: left center;
      }
      100% { 
        transform: scaleX(1);
        transform-origin: left center;
      }
    }
    
    @keyframes panelRollIn {
      0% { 
        transform: scaleX(1);
        transform-origin: left center;
      }
      100% { 
        transform: scaleX(0);
        transform-origin: left center;
      }
    }
    
    @keyframes textFadeIn {
      0% { 
        opacity: 0;
        color: #888;
      }
      50% {
        opacity: 0.5;
        color: #aaa;
      }
      100% { 
        opacity: 1;
        color: white;
      }
    }
    
    @keyframes textFadeOut {
      0% { 
        opacity: 1;
      }
      100% { 
        opacity: 0;
      }
    }
    
    .panel-opening {
      animation: panelRollOut 0.4s ease-out forwards;
    }
    
    .panel-open {
      transform: scaleX(1);
    }
    
    .panel-closing {
      animation: panelRollIn 0.25s ease-in forwards;
    }
    
    .panel-content-opening {
      animation: textFadeIn 0.3s ease-out 0.2s forwards;
      opacity: 0;
    }
    
    .panel-content-open {
      opacity: 1;
      color: white;
    }
    
    .panel-content-closing {
      animation: textFadeOut 0.15s ease-out forwards;
    }

    @keyframes gradientPulse {
      0% { opacity: 0; transform: scale(0.8); }
      50% { opacity: 0.3; transform: scale(1); }
      100% { opacity: 0; transform: scale(1.2); }
    }
    
    .gradient-feedback-active::after {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at center, rgba(255,255,255,0.4) 0%, transparent 70%);
      pointer-events: none;
      animation: gradientPulse 600ms ease-out;
      border-radius: inherit;
    }
    
    .gradient-hover {
      position: relative;
    }
    
    .gradient-hover:hover::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at center, rgba(255,255,255,0.15) 0%, transparent 70%);
      pointer-events: none;
      border-radius: inherit;
    }
    
    .search-result-item:hover {
      background-color: rgba(255,255,255,0.1) !important;
    }
    
    .curate-panel-content::-webkit-scrollbar {
      width: 8px;
    }
    
    .curate-panel-content::-webkit-scrollbar-track {
      background: rgba(0,0,0,0.3);
      border-radius: 4px;
    }
    
    .curate-panel-content::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.3);
      border-radius: 4px;
    }
    
    .curate-panel-content::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.4);
    }

    .scope-button:not(:disabled):hover {
      background-color: rgba(255,255,255,0.2) !important;
    }

    .scope-increment-btn:not(:disabled):hover {
      background-color: rgba(255,255,255,0.2) !important;
    }

    .scope-list-item:hover {
      background-color: rgba(255,255,255,0.1) !important;
      color: #ddd !important;
    }
  `;

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      backgroundColor: '#000000',
      position: 'relative',
      color: 'white',
      fontFamily: "'IAAB3Mono', monospace",
      overflow: 'hidden'
    }}>
      {/* Add font face and gradient animation styles */}
      <style>{fontFaceStyles}</style>
      <style>{gradientAnimationStyles}</style>
      
      {cultures.length === 0 ? (
        <div style={{ 
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          textAlign: 'center' 
        }}>
          <div>
            <h1 style={{ marginBottom: '2rem', fontSize: '2.5rem', fontWeight: '300' }}>
              Belonging
            </h1>
            <p style={{ color: '#888' }}>
              Loading...
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* HEADER AREA */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '60px',
            backgroundColor: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 1.5rem',
            zIndex: 10
          }}>
            {/* Left: Title & Info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '600' }}>
                Belonging
              </h1>
              <div style={{ fontSize: '0.85rem', color: '#888' }}>
                {mode === 'explore' ? (
                  <>
                    {cultures.filter(c => !c.isParentGroup).length} cultures
                    {selectedCulture && (
                      <span style={{ color: '#60a5fa', marginLeft: '1rem' }}>
                        → {selectedCulture.name}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {curatedActivities.length} cultures curated
                  </>
                )}
              </div>
            </div>

            {/* Right: Exit button (explore focus mode only) */}
            {mode === 'explore' && selectedCulture && (
              <button
                onClick={handleExitFocus}
                disabled={isExiting}
                style={{
                  padding: '0.5rem 1.25rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: isExiting ? '#666' : 'white',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  cursor: isExiting ? 'not-allowed' : 'pointer',
                  transition: 'opacity 0.2s',
                  opacity: isExiting ? 0.3 : 0.7
                }}
                onMouseEnter={(e) => {
                  if (!isExiting) {
                    e.target.style.opacity = '1';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isExiting) {
                    e.target.style.opacity = '0.7';
                  }
                }}
              >
                {isExiting ? '⟳ Transitioning...' : '← Back'}
              </button>
            )}
          </div>

          {/* MAIN CONTENT AREA */}
          <div style={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'hidden' 
          }}>
            
            {/* ============ EXPLORE MODE ============ */}
            {mode === 'explore' && (
              <>
                {/* Keyword Search Component - Upper Left Corner (hidden in focus mode) */}
                {!selectedCulture && (
                  <div 
                    className="search-container"
                    style={{
                      position: 'absolute',
                      top: '80px',
                      left: '1.5rem',
                      zIndex: 10,
                      width: '320px'
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        placeholder="Search cultures..."
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '0.875rem 3rem 0.875rem 1rem',
                          backgroundColor: 'rgba(128, 128, 128, 0.25)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.9rem',
                          outline: 'none',
                          fontFamily: "'IAAB3Mono', monospace",
                          transition: 'all 0.2s'
                        }}
                        onFocus={(e) => {
                          e.target.style.backgroundColor = 'rgba(128, 128, 128, 0.35)';
                          e.target.style.borderColor = 'rgba(255,255,255,0.25)';
                        }}
                        onBlur={(e) => {
                          e.target.style.backgroundColor = 'rgba(128, 128, 128, 0.25)';
                          e.target.style.borderColor = 'rgba(255,255,255,0.15)';
                        }}
                      />
                      
                      {/* Microscope Icon */}
                      <img 
                        src="/microscope.png" 
                        alt="search"
                        style={{
                          position: 'absolute',
                          right: '1rem',
                          top: '50%',
                          transform: 'translateY(-50%) scaleX(0.8)',
                          pointerEvents: 'none',
                          filter: 'invert(1) brightness(0.7)',
                          width: '20px',
                          height: '20px',
                          opacity: 0.5
                        }}
                      />
                    </div>
                    
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
                        maxHeight: '400px',
                        overflowY: 'auto',
                        zIndex: 100,
                        backdropFilter: 'blur(10px)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.8)'
                      }}>
                        {searchResults.length > 0 ? (
                          searchResults.map((culture) => (
                            <div
                              key={culture.id}
                              onClick={() => moveCameraToShape(culture)}
                              className="search-result-item"
                              style={{
                                padding: '0.875rem 1rem',
                                cursor: 'pointer',
                                borderBottom: '1px solid rgba(255,255,255,0.1)',
                                transition: 'background-color 0.2s',
                                backgroundColor: 'transparent'
                              }}
                            >
                              <div style={{ fontSize: '0.9rem', color: 'white', fontWeight: '500', pointerEvents: 'none' }}>
                                {culture.name}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem', textTransform: 'capitalize', pointerEvents: 'none' }}>
                                {culture.scopeLevel}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{
                            padding: '1.5rem',
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

                {/* Scope Navigation System - Upper Right Corner (hidden in focus mode) */}
                {!selectedCulture && scopeLevels.length > 1 && (
                  <div style={{
                    position: 'absolute',
                    top: '1.5rem',
                    right: '1.5rem',
                    zIndex: 10,
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'flex-start'
                  }}>
                    {/* Zoom Controls */}
                    <div style={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                      alignItems: 'center'
                    }}>
                      <button
                        onClick={handleZoomIn}
                        style={{
                          width: '36px',
                          height: '36px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: 'white',
                          fontSize: '1.25rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'opacity 0.2s',
                          opacity: 0.7
                        }}
                        onMouseEnter={(e) => e.target.style.opacity = '1'}
                        onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                      >
                        +
                      </button>
                      <button
                        onClick={handleZoomOut}
                        style={{
                          width: '36px',
                          height: '36px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: 'white',
                          fontSize: '1.25rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'opacity 0.2s',
                          opacity: 0.7
                        }}
                        onMouseEnter={(e) => e.target.style.opacity = '1'}
                        onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                      >
                        −
                      </button>
                    </div>
                    {/* Increment/Decrement Buttons
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}>
                      <button
                        onClick={() => {
                          const currentIndex = scopeLevels.indexOf(selectedScope);
                          if (currentIndex < scopeLevels.length - 1) {
                            const newScope = scopeLevels[currentIndex + 1];
                            changeScope(newScope);
                          }
                        }}
                        disabled={scopeLevels.indexOf(selectedScope) === scopeLevels.length - 1}
                        className="scope-increment-btn"
                        style={{
                          width: '50px',
                          height: '50px',
                          backgroundColor: scopeLevels.indexOf(selectedScope) === scopeLevels.length - 1
                            ? 'rgba(255,255,255,0.05)'
                            : 'rgba(255,255,255,0.1)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '8px',
                          color: scopeLevels.indexOf(selectedScope) === scopeLevels.length - 1 ? '#555' : 'white',
                          fontSize: '1.75rem',
                          fontWeight: 'bold',
                          cursor: scopeLevels.indexOf(selectedScope) === scopeLevels.length - 1 ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s',
                          opacity: scopeLevels.indexOf(selectedScope) === scopeLevels.length - 1 ? 0.4 : 1,
                          lineHeight: '1'
                        }}
                        title="Smaller scope"
                      >
                        −
                      </button>

                      <button
                        onClick={() => {
                          const currentIndex = scopeLevels.indexOf(selectedScope);
                          if (currentIndex > 0) {
                            const newScope = scopeLevels[currentIndex - 1];
                            changeScope(newScope);
                          }
                        }}
                        disabled={scopeLevels.indexOf(selectedScope) === 0}
                        className="scope-increment-btn"
                        style={{
                          width: '50px',
                          height: '50px',
                          backgroundColor: scopeLevels.indexOf(selectedScope) === 0
                            ? 'rgba(255,255,255,0.05)'
                            : 'rgba(255,255,255,0.1)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '8px',
                          color: scopeLevels.indexOf(selectedScope) === 0 ? '#555' : 'white',
                          fontSize: '1.75rem',
                          fontWeight: 'bold',
                          cursor: scopeLevels.indexOf(selectedScope) === 0 ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s',
                          opacity: scopeLevels.indexOf(selectedScope) === 0 ? 0.4 : 1,
                          lineHeight: '1'
                        }}
                        title="Larger scope"
                      >
                        +
                      </button>
                    </div> */}

                    {/* Vertical Scope List */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                      minWidth: '140px'
                    }}>
                      {scopeLevels.map((level) => (
                        <button
                          key={level}
                          onClick={() => {
                            changeScope(level);
                          }}
                          className={selectedScope === level ? '' : 'scope-list-item'}
                          style={{
                            padding: '0.5rem 0.75rem',
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: selectedScope === level ? 'white' : '#aaa',
                            fontSize: '0.85rem',
                            fontWeight: selectedScope === level ? '600' : '500',
                            cursor: 'pointer',
                            transition: 'color 0.2s, font-weight 0.2s, opacity 0.2s',
                            textAlign: 'left',
                            textTransform: 'capitalize',
                            position: 'relative',
                            opacity: selectedScope === level ? 1 : 0.7
                          }}
                        >
                          {/* Gradient background */}
                          {/* {selectedScope === level && (
                            <div 
                              style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.25) 0%, transparent 70%)',
                                borderRadius: '6px',
                                pointerEvents: 'none',
                                zIndex: 0,
                                transition: 'opacity 0.2s ease-out'
                              }}
                            />
                          )} */}
                          
                          {/* Text content */}
                          <span style={{ position: 'relative', zIndex: 1 }}>
                            {level}
                          </span>
                          
                          {/* Side indicator bar */}
                          {selectedScope === level && (
                            <div style={{
                              position: 'absolute',
                              left: '-0.5rem',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              width: '3px',
                              height: '60%',
                              backgroundColor: '#60a5fa',
                              borderRadius: '2px',
                              zIndex: 1
                            }} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Canvas Container */}
                <div 
                  ref={containerRef}
                  style={{ 
                    width: '100%', 
                    height: '100%',
                    cursor: isDragging ? 'grabbing' : (hoveredCulture && !hoveredCulture.isParentGroup ? 'pointer' : 'grab'),
                    overflow: 'hidden'
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
                      whiteSpace: 'nowrap'
                    }}>
                      {hoveredCulture.name}
                    </div>
                  )}
                </div>

                {/* Culture Details Overlay (focus mode only) */}
                {selectedCulture && !selectedCulture.isParentGroup && panelAnimationState !== 'closed' && (
                  <div 
                    style={{
                      position: 'absolute',
                      top: '80px',
                      left: '1.5rem',
                      backgroundColor: 'rgba(0,0,0,0.9)',
                      padding: '1.5rem',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.15)',
                      maxHeight: 'calc(100% - 2rem)',
                      overflowY: 'auto',
                      fontSize: '0.85rem',
                      minWidth: '280px',
                      maxWidth: '320px',
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgba(255,255,255,0.3) rgba(0,0,0,0.3)',
                      zIndex: 5,
                      transformOrigin: 'left center'
                    }}
                    className={`culture-details-panel panel-${panelAnimationState}`}
                  >
                    <div className={`panel-content-${panelAnimationState}`}>
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
                        <div>
                          <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>NAME</div>
                          <div style={{ color: 'white', fontWeight: '500' }}>{selectedCulture.name}</div>
                        </div>

                        <div>
                          <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>SCOPE</div>
                          <div style={{ color: 'white', textTransform: 'capitalize' }}>{selectedCulture.scopeLevel}</div>
                        </div>

                        {selectedCulture.values && selectedCulture.values.length > 0 && (
                          <div>
                            <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>VALUES</div>
                            <div style={{ color: 'white' }}>
                              {selectedCulture.values.join(', ')}
                            </div>
                          </div>
                        )}

                        {selectedCulture.kinships && selectedCulture.kinships.length > 0 && (
                          <div>
                            <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>KINSHIPS</div>
                            <div style={{ color: 'white' }}>
                              {selectedCulture.kinships.join(', ')}
                            </div>
                          </div>
                        )}

                        {selectedCulture.affiliations && selectedCulture.affiliations.length > 0 && (
                          <div>
                            <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>AFFILIATIONS</div>
                            <div style={{ color: 'white' }}>
                              {selectedCulture.affiliations.join(', ')}
                            </div>
                          </div>
                        )}

                        <div>
                          <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>KNOWLEDGEBASE</div>
                          <div style={{ color: 'white' }}>{selectedCulture.knowledgebase}/10</div>
                        </div>

                        <div>
                          <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>OPENNESS</div>
                          <div style={{ color: 'white' }}>{selectedCulture.openness}/10</div>
                        </div>

                        <div>
                          <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>POLYGON SIDES</div>
                          <div style={{ color: 'white' }}>{selectedCulture.sides} sides</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ============ CURATE MODE ============ */}
            {mode === 'curate' && (
              <>
                {/* Search Bar with Suggestions - Upper Left */}
                <div 
                  className="search-container"
                  style={{
                    position: 'absolute',
                    top: '80px',
                    left: '1.5rem',
                    zIndex: 10,
                    width: '320px'
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Type to discover cultures..."
                      value={curateSearchInput}
                      onChange={(e) => handleCurateSearch(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '0.875rem 3rem 0.875rem 1rem',
                        backgroundColor: 'rgba(128, 128, 128, 0.25)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px',
                        color: 'white',
                        fontSize: '0.9rem',
                        outline: 'none',
                        fontFamily: "'IAAB3Mono', monospace",
                        transition: 'all 0.2s'
                      }}
                      onFocus={(e) => {
                        e.target.style.backgroundColor = 'rgba(128, 128, 128, 0.35)';
                        e.target.style.borderColor = 'rgba(255,255,255,0.25)';
                      }}
                      onBlur={(e) => {
                        e.target.style.backgroundColor = 'rgba(128, 128, 128, 0.25)';
                        e.target.style.borderColor = 'rgba(255,255,255,0.15)';
                      }}
                    />
                    
                    <img 
                      src="/microscope.png" 
                      alt="search"
                      style={{
                        position: 'absolute',
                        right: '1rem',
                        top: '50%',
                        transform: 'translateY(-50%) scaleX(0.8)',
                        pointerEvents: 'none',
                        filter: 'invert(1) brightness(0.7)',
                        width: '20px',
                        height: '20px',
                        opacity: 0.5
                      }}
                    />
                  </div>
                  
                  {/* Suggestion Dropdown */}
                  {showSuggestionDropdown && activeSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '0.5rem',
                    backgroundColor: 'rgba(0,0,0,0.95)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    zIndex: 100,
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.8)'
                  }}>
                    {activeSuggestions.map((culture) => (
                      <button
                        key={culture.id}
                        onClick={() => handleSuggestionClick(culture)}
                        className="search-result-item"
                        style={{
                          width: '100%',
                          padding: '0.875rem 1rem',
                          backgroundColor: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid rgba(255,255,255,0.1)',
                          color: 'white',
                          fontSize: '0.9rem',
                          fontWeight: '500',
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s',
                          fontFamily: 'system-ui, sans-serif'
                        }}
                      >
                        <div style={{ fontSize: '0.9rem', color: 'white', fontWeight: '500', pointerEvents: 'none' }}>
                          {culture.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem', textTransform: 'capitalize', pointerEvents: 'none' }}>
                          {culture.scopeLevel}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                </div>

                {/* Dynamic Legend - Top Right */}
                {curatedActivities.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '1.5rem',
                    right: '1.5rem',
                    zIndex: 10,
                    minWidth: '200px',
                    maxWidth: '280px',
                    backgroundColor: 'rgba(128, 128, 128, 0.25)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: '#888',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: '0.25rem'
                    }}>
                      Curated Cultures
                    </div>
                    {curatedActivities.map((culture) => {
                      // Get culture color
                      const cultureHue = culture.originalHue !== undefined ? culture.originalHue : 0;
                      const cultureColor = `hsl(${cultureHue}, 80%, 60%)`;
                      
                      return (
                        <div
                          key={culture.id}
                          onClick={() => handleLegendClick(culture)}
                          className="gradient-hover"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            cursor: 'pointer',
                            padding: '0.5rem',
                            borderRadius: '6px',
                            transition: 'background-color 0.2s',
                            position: 'relative'
                          }}
                        >
                          <div style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            backgroundColor: cultureColor,
                            flexShrink: 0
                          }} />
                          <div style={{
                            fontSize: '0.85rem',
                            color: 'white',
                            fontWeight: '500'
                          }}>
                            {culture.name}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Particle Visualization Container */}
                <div 
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative'
                  }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setCurateCursorPos({ x: e.clientX, y: e.clientY });
                    
                    // Check for particle hover
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    const mouseX = e.clientX - rect.left - centerX;
                    const mouseY = e.clientY - rect.top - centerY;
                    
                    let foundParticle = null;
                    for (const particle of curateParticles) {
                      const dx = mouseX - particle.x;
                      const dy = mouseY - particle.y;
                      const distance = Math.sqrt(dx * dx + dy * dy);
                      
                      if (distance < particle.radius + 5) {
                        foundParticle = particle;
                        break;
                      }
                    }
                    
                    setHoveredCurateParticle(foundParticle);
                  }}
                  onMouseLeave={() => setHoveredCurateParticle(null)}
                >
                  <svg
                    ref={curateSvgRef}
                    width={CURATE_BOUNDARY_RADIUS * 2 + 100}
                    height={CURATE_BOUNDARY_RADIUS * 2 + 100}
                    style={{ 
                      filter: 'contrast(1.2) brightness(1.1)',
                      position: 'relative',
                      zIndex: 1
                    }}
                  >
                    <defs>
                      <filter id="glow">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                        <feMerge>
                          <feMergeNode in="coloredBlur"/>
                          <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                      </filter>
                    </defs>
                    
                    <g 
                      transform={`translate(${CURATE_BOUNDARY_RADIUS + 50}, ${CURATE_BOUNDARY_RADIUS + 50})`}
                      style={{ mixBlendMode: 'screen' }}
                    >
                      {curateParticles.map((particle) => (
                        <circle
                          key={particle.id}
                          cx={particle.x}
                          cy={particle.y}
                          r={particle.radius}
                          fill={particle.color}
                          style={{
                            cursor: 'pointer',
                            filter: hoveredCurateParticle?.id === particle.id ? 'brightness(1.5)' : 'none',
                            transition: 'filter 0.2s'
                          }}
                          onClick={() => handleCurateParticleClick(particle)}
                        />
                      ))}
                    </g>
                  </svg>
                  
                  {/* Particle Tooltip */}
                  {hoveredCurateParticle && !showActivityPanel && (
                    <div style={{
                      position: 'absolute',
                      left: curateCursorPos.x + 15,
                      top: curateCursorPos.y + 15,
                      backgroundColor: 'rgba(0, 0, 0, 0.9)',
                      color: 'white',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      fontWeight: '500',
                      pointerEvents: 'none',
                      zIndex: 1000,
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      whiteSpace: 'nowrap'
                    }}>
                      {hoveredCurateParticle.cultureName}
                    </div>
                  )}
                </div>

                {/* Activity Panel */}
                {showActivityPanel && selectedCuratedCulture && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 100,
                    display: 'flex',
                    gap: '2rem',
                    alignItems: 'center',
                    animation: 'fadeIn 0.3s ease-out'
                  }}>
                    <style>{`
                      @keyframes fadeIn {
                        from { opacity: 0; transform: translate(-50%, -45%); }
                        to { opacity: 1; transform: translate(-50%, -50%); }
                      }
                      @keyframes rotate {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                      }
                    `}</style>
                    
                    {/* Main Info Panel */}
                    <div style={{
                      width: '400px',
                      maxHeight: '70vh',
                      backgroundColor: 'rgba(0,0,0,0.95)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column'
                    }}>
                      <div style={{ 
                        padding: '2rem',
                        overflowY: 'auto',
                        flex: 1,
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(255,255,255,0.3) rgba(0,0,0,0.3)'
                      }}
                      className="curate-panel-content"
                      >
                        <h2 style={{
                          margin: '0 0 1rem 0',
                          fontSize: '1.5rem',
                          fontWeight: '600',
                          color: 'white'
                        }}>
                          {selectedCuratedCulture.name}
                        </h2>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.9rem' }}>
                          <div>
                            <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>SCOPE</div>
                            <div style={{ color: '#bbb', textTransform: 'capitalize' }}>{selectedCuratedCulture.scopeLevel}</div>
                          </div>
                          
                          {selectedCuratedCulture.values && selectedCuratedCulture.values.length > 0 && (
                            <div>
                              <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>VALUES</div>
                              <div style={{ color: '#bbb' }}>
                                {selectedCuratedCulture.values.join(', ')}
                              </div>
                            </div>
                          )}
                          
                          <div>
                            <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>KNOWLEDGEBASE</div>
                            <div style={{ color: '#bbb' }}>{selectedCuratedCulture.knowledgebase}/10</div>
                          </div>
                          
                          <div>
                            <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>OPENNESS</div>
                            <div style={{ color: '#bbb' }}>{selectedCuratedCulture.openness}/10</div>
                          </div>
                        </div>
                      </div>
                      
                      <div style={{
                        borderTop: '1px solid rgba(255,255,255,0.1)',
                        padding: '1rem 2rem'
                      }}>
                        <button
                          onClick={() => handleViewKinships(selectedCuratedCulture)}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: 'white',
                            fontSize: '0.9rem',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'opacity 0.2s',
                            opacity: 0.7
                          }}
                          onMouseEnter={(e) => e.target.style.opacity = '1'}
                          onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                        >
                          View kinships in explore mode
                        </button>
                      </div>
                    </div>

                    {/* Rotating Shape with Particles and Curate Button */}
                    <div style={{
                      width: '200px',
                      height: '200px',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {/* Particle visualization */}
                      <svg
                        width="200"
                        height="200"
                        style={{
                          position: 'absolute',
                          filter: 'contrast(1.2) brightness(1.1)'
                        }}
                      >
                        <g 
                          transform="translate(100, 100)"
                          style={{ mixBlendMode: 'screen' }}
                        >
                          {shapeParticles.map((particle) => (
                            <circle
                              key={particle.id}
                              cx={particle.x}
                              cy={particle.y}
                              r={particle.size}
                              fill={particle.color}
                            />
                          ))}
                        </g>
                      </svg>
                      
                      {/* Subtle Curate Button */}
                      <button
                        id="curate-action-button"
                        onClick={() => handleCurateCulture(selectedCuratedCulture)}
                        style={{
                          padding: '0.75rem 1.5rem',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: 'white',
                          fontSize: '0.9rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'opacity 0.2s',
                          position: 'relative',
                          zIndex: 2,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          opacity: 0.7
                        }}
                        onMouseEnter={(e) => e.target.style.opacity = '1'}
                        onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                      >
                        {curatedActivities.find(c => c.id === selectedCuratedCulture.id) ? 'Curated' : 'Curate'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* NAVIGATION BAR AT BOTTOM */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '80px',
            backgroundColor: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 1.5rem',
            gap: '2rem',
            zIndex: 10
          }}>
            {/* Left: Mode Toggle */}
            <div style={{ flex: '0 0 auto' }}>
              <button
                id="mode-toggle-button"
                onClick={handleModeToggle}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'white',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                  opacity: 0.7,
                  textTransform: 'capitalize'
                }}
                onMouseEnter={(e) => e.target.style.opacity = '1'}
                onMouseLeave={(e) => e.target.style.opacity = '0.7'}
              >
                {mode === 'explore' ? 'Curate' : 'Explore'}
              </button>
            </div>

            {/* Center: Instructions */}
            <div style={{ flex: 1, textAlign: 'center' }}>
              {mode === 'explore' && !selectedCulture && (
                <div style={{ fontSize: '0.85rem', color: '#888' }}>
                  🖱️ Drag to pan • Click culture to focus
                </div>
              )}
              {mode === 'curate' && (
                <div style={{ fontSize: '0.85rem', color: '#888' }}>
                  Type trigger characters (c, m, s, p, a) to discover cultures
                </div>
              )}
            </div>

            {/* Right: Zoom (explore) or Clear (curate) */}
            <div style={{ flex: '0 0 auto' }}>
              {/* {mode === 'explore' && !selectedCulture && (
                <div style={{ 
                  display: 'flex',
                  gap: '0.5rem',
                  alignItems: 'center'
                }}>
                  <button
                    onClick={handleZoomOut}
                    style={{
                      width: '36px',
                      height: '36px',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '1.25rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                  >
                    −
                  </button>
                  <div style={{
                    fontSize: '0.85rem',
                    color: '#888',
                    minWidth: '60px',
                    textAlign: 'center'
                  }}>
                    {`${Math.round(camera.zoom * 100)}%`}
                  </div>
                  <button
                    onClick={handleZoomIn}
                    style={{
                      width: '36px',
                      height: '36px',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '1.25rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                  >
                    +
                  </button>
                  <button
                    onClick={handleZoomReset}
                    style={{
                      width: '36px',
                      height: '36px',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background-color 0.2s',
                      marginLeft: '0.25rem'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                    title="Reset Zoom"
                  >
                    ⊙
                  </button>
                </div>
              )} */}
              
              {mode === 'curate' && (
                <button
                  id="clear-button"
                  onClick={handleClearCurate}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: 'white',
                    fontSize: '0.9rem',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'opacity 0.2s',
                    opacity: 0.7
                  }}
                  onMouseEnter={(e) => e.target.style.opacity = '1'}
                  onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default KinshipVisualization;