import React from 'react';

const ColorPicker = ({ colors, onSelect, selectedColor }) => {
  return (
    <div className="color-picker">
      {colors.map((color, index) => (
        <div
          key={index}
          style={{
            backgroundColor: color,
            width: '20px',
            height: '20px',
            margin: '5px',
            border: index === selectedColor ? '2px solid black' : '1px solid gray',
            cursor: 'pointer',
          }}
          onClick={() => onSelect(index)}
        />
      ))}
    </div>
  );
};

export default ColorPicker;