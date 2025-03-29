import React, { useState } from 'react';
import './ColorPicker.css';

const ColorPicker = ({ colors, onSelect, selectedColor }) => {
  const [customColor, setCustomColor] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customColorValue, setCustomColorValue] = useState(null); // Stocker la couleur custom

  const handleColorClick = (index) => {
    if (selectedColor === index) {
      onSelect(null, null); // Désélectionner si déjà sélectionné
      setCustomColorValue(null); // Réinitialiser la couleur custom
    } else {
      onSelect(index, colors[index]); // Sélectionner une couleur de la liste
      setCustomColorValue(null); // Réinitialiser la couleur custom
    }
    setShowCustomInput(false); // Fermer la pop-in
  };

  const handleCustomColorChange = (e) => {
    let value = e.target.value.toUpperCase();
    setCustomColor(value);
  };

  const handleCustomColorSubmit = () => {
    let colorHex = customColor;
    if (!colorHex.startsWith('#')) {
      colorHex = `#${colorHex}`;
    }
    if (/^#[0-9A-F]{6}$/.test(colorHex)) {
      const colorIndex = colors.indexOf(colorHex);
      if (colorIndex !== -1) {
        onSelect(colorIndex, colorHex); // Si la couleur existe dans COLORS, on la sélectionne
        setCustomColorValue(null);
      } else {
        onSelect(-1, colorHex); // -1 indique une couleur personnalisée
        setCustomColorValue(colorHex); // Stocker la couleur custom pour l'afficher
      }
      setShowCustomInput(false); // Fermer la pop-in
      setCustomColor(''); // Réinitialiser l'entrée
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleCustomColorSubmit();
    }
  };

  const toggleCustomInput = () => {
    setShowCustomInput(!showCustomInput);
    setCustomColor(''); // Réinitialiser l'entrée lors de l'ouverture
  };

  return (
    <div className="color-picker">
      {colors.map((color, index) => (
        <div
          key={index}
          className={`color-swatch ${selectedColor === index ? 'selected' : ''}`}
          style={{ backgroundColor: color }}
          onClick={() => handleColorClick(index)}
        />
      ))}
      <div
        className={`color-swatch custom-color ${selectedColor === -1 && customColorValue ? 'selected' : ''}`}
        style={{
          background: customColorValue
            ? customColorValue
            : 'linear-gradient(90deg, red, orange, yellow, green, cyan, blue, magenta, red)',
        }}
        onClick={toggleCustomInput}
      />
      {showCustomInput && (
        <div className="custom-color-popin">
          <input
            type="text"
            placeholder="#FF0000"
            value={customColor}
            onChange={handleCustomColorChange}
            onKeyPress={handleKeyPress}
            maxLength={7} // Permettre # + 6 caractères
            className="hex-input"
            autoFocus
          />
          <button className="popin-close" onClick={toggleCustomInput}>×</button>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;