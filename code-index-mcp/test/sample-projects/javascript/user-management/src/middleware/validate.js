const { validationResult } = require('express-validator');
const { ValidationError } = require('../utils/errors');

/**
 * Validation middleware
 * Checks for validation errors and returns appropriate error response
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value,
    }));
    
    const validationError = new ValidationError(
      'Validation failed',
      errorMessages
    );
    
    return next(validationError);
  }
  
  next();
};

module.exports = validate;