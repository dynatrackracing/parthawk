import React from "react";

const Modal = ({ title, children, footer }) => {
  const closeModal = () => {
    const modal = document.getElementById("modal-btn");
    modal.checked = false;
  };

  return (
    <div className="section">
      <input
        className="modal-btn"
        type="checkbox"
        id="modal-btn"
        name="modal-btn"
      />
      <div className="modal">
        <div className="modal-wrap">
          <div onClick={() => closeModal()} className="model-icon-wrap">
            <span className="modal-icon">&nbsp;</span>
          </div>

          <h3 className="modal-wrap__title">{title}</h3>

          {children}

          <div className="model-footer">{footer}</div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
