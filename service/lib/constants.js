'use strict';

const path = require('path');

let dataDir = path.resolve(__dirname, '..', 'data');


const makes = [
  'Acura',
  'Audi',
  'Buick',
  'BMW',
  'Cadillac',
  'Chevrolet',
  'Chrysler',
  'Daihatsu',
  'Dodge',
  'Ford',
  'Geo',
  'GMC',
  'Honda',
  'Hyundai',
  'Infiniti',
  'Isuzu',
  'Jaguar',
  'Jeep',
  'Kia',
  'Land Rover',
  'Lexus',
  'Lincoln',
  'Mazda',
  'Mercedes-Benz',
  'Mercury',
  'Mini',
  'Mitsubishi',
  'Nissan',
  'Pontiac',
  'Porsche',
  'Ram',
  'Saab',
  'Saturn',
  'Scion',
  'Smart',
  'Subaru',
  'Suzuki',
  'Toyota',
  'Volkswagen',
  'Volvo',
];

const constants = {
  get dataDir() {
    return dataDir;
  },
  get makes() {
    return makes;
  }
}

module.exports = constants;