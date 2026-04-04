/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Camera, 
  MapPin, 
  Calendar, 
  Navigation, 
  Loader2, 
  Upload, 
  Map as MapIcon, 
  Compass, 
  Info,
  Music,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface LandmarkInfo {
  name: string;
  location: string;
  description: string;
  events: { title: string; date: string; link: string }[];
  coordinates?: { lat: number; lng: number };
}

interface TripPlan {
  itinerary: string;
}

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [landmark, setLandmark] = useState<LandmarkInfo | null>(null);
  const [tripPlan, setTripPlan] = useState<TripPlan | null>(null);
  const [distance, setDistance] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Trip Preferences
  const [duration, setDuration] = useState<number>(3);
  const [budget, setBudget] = useState<string>('Medium');
  const [style, setStyle] = useState<string>('Medium');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          if (landmark?.coordinates) {
            setDistance(calculateDistance(position.coords.latitude, position.coords.longitude, landmark.coordinates.lat, landmark.coordinates.lng));
          }
        },
        (err) => {
          console.warn("Geolocation error:", err);
          setError("Could not access your location. Please check your settings.");
        }
      );
    }
  };

  useEffect(() => {
    refreshLocation();
  }, []);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d > 1000 ? `${(d / 1000).toFixed(1)}k km` : `${d.toFixed(0)} km`;
  };

  const deg2rad = (deg: number) => deg * (Math.PI / 180);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        setError("Image is too large. Please select a photo smaller than 10MB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setLandmark(null);
        setTripPlan(null);
        setDistance(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async () => {
    if (!image) return;
    setAnalyzing(true);
    setError(null);

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("API Key is missing. Please check your configuration.");
      }

      // Extract base64 and mimeType from data URL
      const matches = image.match(/^data:(.+);base64,(.+)$/);
      if (!matches) {
        throw new Error("Invalid image format. Please try another photo.");
      }
      const mimeType = matches[1];
      const base64Data = matches[2];
      
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: mimeType } },
            { text: "Identify this landmark. If it is not a recognizable landmark or place, please state that in the description. Provide its name, location (city, country), a brief description, and its approximate latitude and longitude coordinates. Also, search for any major upcoming events or concerts happening near this location in the next few months. Return the data in JSON format." }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              location: { type: Type.STRING },
              description: { type: Type.STRING },
              coordinates: {
                type: Type.OBJECT,
                properties: {
                  lat: { type: Type.NUMBER },
                  lng: { type: Type.NUMBER }
                }
              },
              events: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    date: { type: Type.STRING },
                    link: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      });

      if (!response.text) {
        throw new Error("No response from AI. Please try again.");
      }

      let data: LandmarkInfo;
      try {
        data = JSON.parse(response.text) as LandmarkInfo;
      } catch (e) {
        console.error("JSON Parse Error:", e, response.text);
        throw new Error("Failed to process the AI response. Please try again.");
      }
      
      if (!data.name || data.name.toLowerCase().includes("unknown") || data.name.toLowerCase().includes("none")) {
        setError("I couldn't identify this landmark. Please try a clearer photo of a famous place.");
        setLandmark(null);
      } else {
        setLandmark(data);
        if (userLocation && data.coordinates) {
          setDistance(calculateDistance(userLocation.lat, userLocation.lng, data.coordinates.lat, data.coordinates.lng));
        }
      }
    } catch (err: any) {
      console.error("Analysis Error:", err);
      const message = err?.message || "An unexpected error occurred.";
      setError(`Analysis failed: ${message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const planTrip = async () => {
    if (!landmark) return;
    setPlanning(true);

    try {
      const response = await genAI.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Create a detailed ${duration}-day trip itinerary for ${landmark.name} in ${landmark.location}. 
        The budget for this trip is ${budget} and the travel style should be ${style}. 
        Include travel tips, best time to visit, and local food recommendations. Format with markdown.`,
      });

      setTripPlan({ itinerary: response.text || '' });
    } catch (err) {
      console.error(err);
      setError("Failed to generate trip plan.");
    } finally {
      setPlanning(false);
    }
  };

  const backgroundImages = [
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=1920", // Beach
    "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=1920", // Mountains
    "https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&q=80&w=1920", // Backpack/Hiking
    "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&q=80&w=1920", // City
    "https://images.unsplash.com/photo-1530789253388-582c481c54b0?auto=format&fit=crop&q=80&w=1920"  // Travel gear
  ];

  const [bgIndex, setBgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % backgroundImages.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen journal-bg text-neutral-900 font-sans selection:bg-indigo-100">
      {/* Immersive Hero Section */}
      <div className="relative h-[70vh] min-h-[600px] w-full overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div 
            key={bgIndex}
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2 }}
            className="absolute inset-0 z-0"
          >
            <img 
              src={backgroundImages[bgIndex]} 
              alt="Travel Background" 
              className="w-full h-full object-cover brightness-[0.4]"
              referrerPolicy="no-referrer"
            />
          </motion.div>
        </AnimatePresence>
        
        <div className="absolute inset-0 z-10 bg-gradient-to-b from-black/40 via-transparent to-[#fafafa]" />

        <div className="relative z-20 h-full flex flex-col items-center justify-center px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-8 max-w-4xl"
          >
            <div className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-sm font-bold tracking-widest uppercase">
              <Compass className="w-4 h-4 text-indigo-400 animate-spin-slow" />
              <span>Explore the Unexplored</span>
            </div>
            <h1 className="text-6xl md:text-8xl font-extrabold text-white tracking-tighter leading-[0.9]">
              Your Journey <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">Starts Here</span>
            </h1>
            <p className="text-xl md:text-2xl text-neutral-200 font-medium max-w-2xl mx-auto leading-relaxed">
              Snap a photo, upload your inspiration, and let AI craft your perfect escape to mountains, beaches, and beyond.
            </p>
            
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              {['Mountains', 'Beaches', 'Cities', 'Nature'].map((tag) => (
                <span key={tag} className="px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/60 text-xs font-bold uppercase tracking-tighter">
                  #{tag}
                </span>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Floating Distance Bar */}
        {distance && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-4"
          >
            <div className="glass-card px-6 py-3 rounded-full flex items-center gap-3 text-indigo-700 font-bold shadow-2xl">
              <Navigation className="w-5 h-5 animate-pulse" />
              <span>{distance} from your current location</span>
            </div>
            <button 
              onClick={refreshLocation}
              className="px-4 py-2 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white text-xs font-bold uppercase tracking-widest hover:bg-white/30 transition-all"
            >
              Update Location
            </button>
          </motion.div>
        )}
      </div>

      <main className="max-w-6xl mx-auto px-6 -mt-24 relative z-40 pb-24 space-y-16">
        {/* Upload Portal */}
        <section className="max-w-3xl mx-auto">
          <motion.div
            whileHover={{ y: -5 }}
            className="glass-card p-4 rounded-[2.5rem] shadow-2xl bg-white/80"
          >
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative aspect-[16/10] rounded-[2rem] border-2 border-dashed border-neutral-200 bg-neutral-50/50 flex flex-col items-center justify-center cursor-pointer transition-all hover:border-indigo-400 hover:bg-indigo-50/30 group overflow-hidden",
                image && "border-none shadow-inner"
              )}
            >
              {image ? (
                <>
                  <img src={image} alt="Preview" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                    <div className="bg-white/20 backdrop-blur-md border border-white/30 px-6 py-3 rounded-2xl text-white font-bold flex items-center gap-2">
                      <Upload className="w-5 h-5" /> Change Destination
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-6 text-neutral-400 group-hover:text-indigo-600 transition-all duration-500">
                  <div className="w-24 h-24 rounded-3xl bg-white shadow-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                    <Camera className="w-10 h-10" />
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-neutral-800">Drop your travel inspiration</p>
                    <p className="text-sm font-medium">JPG, PNG or WebP up to 10MB</p>
                  </div>
                </div>
              )}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                className="hidden" 
                accept="image/*" 
              />
            </div>

            {image && !landmark && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={analyzeImage}
                  disabled={analyzing}
                  className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-xl shadow-indigo-200 active:scale-[0.98]"
                >
                  {analyzing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Compass className="w-6 h-6" />}
                  {analyzing ? "Consulting Travel Experts..." : "Identify Destination"}
                </button>
              </div>
            )}
          </motion.div>
        </section>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-3xl mx-auto p-6 bg-red-50 border border-red-100 text-red-600 rounded-3xl text-center font-bold shadow-lg"
          >
            {error}
          </motion.div>
        )}

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {landmark && (
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              className="space-y-12"
            >
              <div className="grid lg:grid-cols-12 gap-12">
                <div className="lg:col-span-8 space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm uppercase tracking-[0.2em]">
                      <MapPin className="w-5 h-5" />
                      {landmark.location}
                    </div>
                    <h3 className="text-5xl md:text-7xl font-extrabold text-neutral-900 tracking-tight leading-none">
                      {landmark.name}
                    </h3>
                    <p className="text-xl text-neutral-600 leading-relaxed font-medium">
                      {landmark.description}
                    </p>
                  </div>

                  {/* Trip Preferences Controls */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white/50 backdrop-blur-sm p-6 rounded-3xl border border-neutral-100 shadow-sm">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Duration (Days)</label>
                      <select 
                        value={duration} 
                        onChange={(e) => setDuration(Number(e.target.value))}
                        className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2 font-bold text-neutral-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      >
                        {[1, 2, 3, 4, 5, 7, 10, 14].map(d => (
                          <option key={d} value={d}>{d} {d === 1 ? 'Day' : 'Days'}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Budget</label>
                      <select 
                        value={budget} 
                        onChange={(e) => setBudget(e.target.value)}
                        className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2 font-bold text-neutral-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      >
                        {['Low', 'Medium', 'Luxury'].map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Style</label>
                      <select 
                        value={style} 
                        onChange={(e) => setStyle(e.target.value)}
                        className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2 font-bold text-neutral-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      >
                        {['Relaxed', 'Medium', 'Active'].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-6">
                    <button
                      onClick={planTrip}
                      disabled={planning}
                      className="bg-indigo-600 text-white px-10 py-5 rounded-2xl font-bold text-lg flex items-center gap-3 hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-100 disabled:opacity-50 active:scale-95"
                    >
                      {planning ? <Loader2 className="w-6 h-6 animate-spin" /> : <Calendar className="w-6 h-6" />}
                      Plan My Trip
                    </button>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(landmark.name + ' ' + landmark.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-white text-neutral-900 border-2 border-neutral-100 px-10 py-5 rounded-2xl font-bold text-lg flex items-center gap-3 hover:bg-neutral-50 transition-all shadow-xl active:scale-95"
                    >
                      <MapIcon className="w-6 h-6 text-indigo-600" />
                      Get Directions
                    </a>
                    <button
                      onClick={() => {
                        setImage(null);
                        setLandmark(null);
                        setTripPlan(null);
                        setDistance(null);
                        setError(null);
                      }}
                      className="bg-neutral-100 text-neutral-600 px-10 py-5 rounded-2xl font-bold text-lg flex items-center gap-3 hover:bg-neutral-200 transition-all active:scale-95"
                    >
                      New Search
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-4">
                  <div className="bg-white p-8 rounded-[2.5rem] border border-neutral-100 space-y-8 shadow-2xl sticky top-24">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 font-bold text-xl text-neutral-900">
                        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                          <Music className="w-6 h-6 text-purple-600" />
                        </div>
                        Nearby Events
                      </div>
                    </div>
                    <div className="space-y-6">
                      {landmark.events && landmark.events.length > 0 ? (
                        landmark.events.map((event, idx) => (
                          <motion.div 
                            key={idx} 
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className="group cursor-pointer p-4 rounded-2xl hover:bg-neutral-50 transition-all border border-transparent hover:border-neutral-100"
                          >
                            <div className="text-xs text-indigo-500 font-bold uppercase tracking-wider mb-2">{event.date}</div>
                            <div className="font-extrabold text-lg text-neutral-800 group-hover:text-indigo-600 transition-colors flex items-center justify-between gap-4">
                              <span className="line-clamp-2">{event.title}</span>
                              <ExternalLink className="w-5 h-5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0" />
                            </div>
                          </motion.div>
                        ))
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                          <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center">
                            <Calendar className="w-8 h-8 text-neutral-300" />
                          </div>
                          <p className="text-neutral-400 font-medium italic">
                            No upcoming major events found nearby.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Trip Plan Section */}
              {tripPlan && (
                <motion.div
                  initial={{ opacity: 0, y: 60 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-10 md:p-16 rounded-[3rem] border border-neutral-100 shadow-2xl space-y-12 relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl opacity-50" />
                  
                  <div className="flex flex-col md:flex-row md:items-center gap-6 border-b border-neutral-100 pb-10 relative z-10">
                    <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white shadow-2xl shadow-indigo-200">
                      <Info className="w-10 h-10" />
                    </div>
                    <div>
                      <h4 className="text-3xl font-extrabold tracking-tight text-neutral-900">Your Custom Itinerary</h4>
                      <p className="text-lg text-neutral-500 font-medium">Crafted specifically for your {landmark.name} adventure</p>
                    </div>
                  </div>
                  
                  <div className="prose prose-neutral max-w-none relative z-10">
                    <ReactMarkdown>{tripPlan.itinerary}</ReactMarkdown>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="bg-neutral-900 text-white py-20">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
                <Compass className="w-6 h-6" />
              </div>
              <span className="text-2xl font-black tracking-tighter">VisionVoyage AI</span>
            </div>
            <p className="text-neutral-400 max-w-md text-lg">
              Empowering travelers with artificial intelligence to explore the world's most iconic landmarks with ease and wonder.
            </p>
          </div>
          <div className="flex flex-col md:items-end gap-4 text-neutral-400">
            <p className="font-bold text-white">VisionVoyage AI © 2026</p>
            <p>Powered by Google Gemini 3.1 Pro</p>
            <div className="flex gap-6 mt-4">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 cursor-pointer transition-colors">
                <Camera className="w-5 h-5" />
              </div>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 cursor-pointer transition-colors">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 cursor-pointer transition-colors">
                <Compass className="w-5 h-5" />
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
