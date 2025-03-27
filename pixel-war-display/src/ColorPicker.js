import React from 'react';
import './ColorPicker.css';

const ColorPicker = ({ colors, onSelect, selectedColor }) => {
  return (
    <div className="color-picker">
      {colors.map((color, index) => (
        <div
          key={index}
          className={`color-swatch ${selectedColor === index ? 'selected' : ''}`}
          style={{ backgroundColor: color }}
          onClick={() => onSelect(index)}
        />
      ))}
    </div>
  );
};

export default ColorPicker;