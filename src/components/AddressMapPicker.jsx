import { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, MapPin, Minus, Plus, Search } from 'lucide-react';
import '../address-map.css';

const TILE_SIZE = 256;
const CAMPUS = { latitude: 14.6236, longitude: 121.0614 };

function clampLatitude(value) {
    return Math.max(-85.05112878, Math.min(85.05112878, value));
}

function toWorld(latitude, longitude, zoom) {
    const scale = TILE_SIZE * (2 ** zoom);
    const lat = clampLatitude(latitude) * Math.PI / 180;
    return {
        x: ((longitude + 180) / 360) * scale,
        y: (0.5 - Math.log((1 + Math.sin(lat)) / (1 - Math.sin(lat))) / (4 * Math.PI)) * scale
    };
}

function fromWorld(x, y, zoom) {
    const scale = TILE_SIZE * (2 ** zoom);
    const wrappedX = ((x % scale) + scale) % scale;
    const boundedY = Math.max(0, Math.min(scale, y));
    const longitude = wrappedX / scale * 360 - 180;
    const n = Math.PI - 2 * Math.PI * boundedY / scale;
    const latitude = 180 / Math.PI * Math.atan(Math.sinh(n));
    return { latitude, longitude };
}

// Address map
export function AddressMapPicker({ addressText, onAddressTextChange, coordinates, onCoordinatesChange }) {
    const mapRef = useRef(null);
    const dragRef = useRef(null);
    const [center, setCenter] = useState(() => coordinates?.latitude != null && coordinates?.longitude != null
        ? { latitude: Number(coordinates.latitude), longitude: Number(coordinates.longitude) }
        : CAMPUS);
    const [zoom, setZoom] = useState(16);
    const [size, setSize] = useState({ width: 640, height: 280 });
    const [dragging, setDragging] = useState(false);
    const [searching, setSearching] = useState(false);
    const [mapError, setMapError] = useState('');

    useEffect(() => {
        if (coordinates?.latitude == null || coordinates?.longitude == null) return;
        const latitude = Number(coordinates.latitude);
        const longitude = Number(coordinates.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) setCenter({ latitude, longitude });
    }, [coordinates?.latitude, coordinates?.longitude]);

    useEffect(() => {
        const element = mapRef.current;
        if (!element) return undefined;
        const measure = () => setSize({ width: Math.max(300, element.clientWidth), height: Math.max(220, element.clientHeight) });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const layout = useMemo(() => {
        const world = toWorld(center.latitude, center.longitude, zoom);
        const left = world.x - size.width / 2;
        const top = world.y - size.height / 2;
        const startX = Math.floor(left / TILE_SIZE);
        const startY = Math.floor(top / TILE_SIZE);
        const cols = Math.ceil(size.width / TILE_SIZE) + 2;
        const rows = Math.ceil(size.height / TILE_SIZE) + 2;
        const tileCount = 2 ** zoom;
        const tiles = [];
        for (let row = 0; row < rows; row += 1) {
            const tileY = startY + row;
            if (tileY < 0 || tileY >= tileCount) continue;
            for (let col = 0; col < cols; col += 1) {
                const tileX = startX + col;
                const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
                tiles.push({ key: `${zoom}-${wrappedX}-${tileY}`, src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`, left: tileX * TILE_SIZE - left, top: tileY * TILE_SIZE - top });
            }
        }
        let marker = null;
        if (coordinates?.latitude != null && coordinates?.longitude != null) {
            const point = toWorld(Number(coordinates.latitude), Number(coordinates.longitude), zoom);
            marker = { left: point.x - left, top: point.y - top };
        }
        return { tiles, marker, world, left, top };
    }, [center, zoom, size, coordinates?.latitude, coordinates?.longitude]);

    function pickAt(clientX, clientY) {
        const bounds = mapRef.current.getBoundingClientRect();
        const point = fromWorld(layout.world.x + (clientX - bounds.left - size.width / 2), layout.world.y + (clientY - bounds.top - size.height / 2), zoom);
        onCoordinatesChange(point);
        setMapError('');
    }

    function pointerDown(event) {
        if (event.button !== 0) return;
        dragRef.current = { x: event.clientX, y: event.clientY, world: toWorld(center.latitude, center.longitude, zoom), moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(false);
    }

    function pointerMove(event) {
        if (!dragRef.current) return;
        const dx = event.clientX - dragRef.current.x;
        const dy = event.clientY - dragRef.current.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
        if (dragRef.current.moved) {
            setDragging(true);
            setCenter(fromWorld(dragRef.current.world.x - dx, dragRef.current.world.y - dy, zoom));
        }
    }

    function pointerUp(event) {
        if (!dragRef.current) return;
        if (!dragRef.current.moved) pickAt(event.clientX, event.clientY);
        dragRef.current = null;
        setDragging(false);
    }

    async function findAddress() {
        const query = String(addressText || '').trim();
        if (query.length < 4) {
            setMapError('Enter an address first, then tap Find on map.');
            return;
        }
        setSearching(true);
        setMapError('');
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('Address lookup is temporarily unavailable. You can still tap the map to set a pin.');
            const results = await response.json();
            if (!results.length) throw new Error('Address not found. Try adding the city or a nearby landmark.');
            const result = results[0];
            const point = { latitude: Number(result.lat), longitude: Number(result.lon) };
            setCenter(point);
            onCoordinatesChange(point);
            onAddressTextChange(result.display_name || query);
        } catch (error) {
            setMapError(error.message || 'Could not search that address.');
        } finally {
            setSearching(false);
        }
    }

    async function usePinAddress() {
        if (coordinates?.latitude == null || coordinates?.longitude == null) {
            setMapError('Tap the map to set a pin first.');
            return;
        }
        setSearching(true);
        setMapError('');
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(coordinates.latitude)}&lon=${encodeURIComponent(coordinates.longitude)}`;
            const response = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('Address lookup is temporarily unavailable. You can type the address manually.');
            const result = await response.json();
            if (!result.display_name) throw new Error('No street address was found for that map pin. You can type the address manually.');
            onAddressTextChange(result.display_name);
        } catch (error) {
            setMapError(error.message || 'Could not turn that pin into a street address.');
        } finally {
            setSearching(false);
        }
    }

    function useCurrentLocation() {
        setMapError('');
        if (!navigator.geolocation) {
            setMapError('This device does not provide location access.');
            return;
        }
        navigator.geolocation.getCurrentPosition((position) => {
            const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
            setCenter(point);
            onCoordinatesChange(point);
        }, () => setMapError('Location permission was denied or your current location is unavailable.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    }

    return (
        <div className="address-map-picker">
            <div className="address-map-actions">
                <button type="button" className="secondary-button small-button" onClick={findAddress} disabled={searching}><Search size={15} /> {searching ? 'Finding…' : 'Find address on map'}</button>
                <button type="button" className="secondary-button small-button" onClick={useCurrentLocation}><LocateFixed size={15} /> Use my location</button>
                <button type="button" className="secondary-button small-button" onClick={usePinAddress} disabled={searching || coordinates?.latitude == null || coordinates?.longitude == null}><MapPin size={15} /> Use pin address</button>
            </div>
            <div ref={mapRef} className={`address-map-canvas ${dragging ? 'is-dragging' : ''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { dragRef.current = null; setDragging(false); }}>
                {layout.tiles.map((tile) => <img key={tile.key} className="address-map-tile" src={tile.src} alt="" draggable="false" style={{ left: tile.left, top: tile.top }} />)}
                {layout.marker && <div className="address-map-marker" style={{ left: layout.marker.left, top: layout.marker.top }}><MapPin size={27} fill="currentColor" /></div>}
                <div className="address-map-crosshair" aria-hidden="true">＋</div>
                <div className="address-map-zoom"><button type="button" onClick={() => setZoom((value) => Math.min(19, value + 1))} aria-label="Zoom in"><Plus size={17} /></button><button type="button" onClick={() => setZoom((value) => Math.max(3, value - 1))} aria-label="Zoom out"><Minus size={17} /></button></div>
                <div className="address-map-tip">Tap map to drop pin · Drag to move</div>
                <a className="address-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>© OpenStreetMap</a>
            </div>
            {coordinates?.latitude != null && coordinates?.longitude != null && <p className="address-map-coordinates">Pin: {Number(coordinates.latitude).toFixed(6)}, {Number(coordinates.longitude).toFixed(6)}</p>}
            {mapError && <p className="form-error" role="alert">{mapError}</p>}
        </div>
    );
}
