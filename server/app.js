const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');

// DatabaseService handles all database-related operations
class DatabaseService {
  constructor() {
    console.log('Initializing DatabaseService...');
    this.pool = new Pool({
      connectionString: 'postgresql://admin:JAc6pXCdY0vMQzOHGKonb2O3zpdNXd4R@dpg-ct95fdl6l47c73an6bpg-a.oregon-postgres.render.com/donordb', // Hardcoded DB URL
      ssl: { rejectUnauthorized: false }, // Ensures SSL connection
    });
  }

  async query(sql, params) {
    console.log(`Executing query: ${sql} with params ${params}`);
    return this.pool.query(sql, params);
  }
}

// LocationService fetches coordinates and calculates distances
class LocationService {
  static async getCoordinatesFromPincode(pincode) {
    console.log(`Fetching coordinates for pincode: ${pincode}`);
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${pincode}&format=json`;
    try {
      const response = await axios.get(url);

      if (response.data.length > 0) {
        const { lat, lon } = response.data[0];
        console.log(`Found coordinates: Latitude = ${lat}, Longitude = ${lon}`);
        return { latitude: parseFloat(lat), longitude: parseFloat(lon) };
      }

      throw new Error('Invalid pincode or no data available.');
    } catch (error) {
      console.error(`Error fetching coordinates: ${error.message}`);
      throw error;
    }
  }

  static calculateDistance(lat1, lon1, lat2, lon2) {
    console.log(`Calculating distance between (${lat1}, ${lon1}) and (${lat2}, ${lon2})`);
    const R = 6371; // Earth's radius in kilometers
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    console.log(`Calculated distance: ${distance} km`);
    return distance;
  }
}

// DonorService handles donor-related database operations
class DonorService {
  constructor(dbService) {
    console.log('Initializing DonorService...');
    this.dbService = dbService;
  }

  async setupOutputTable() {
    console.log('Setting up the output table...');
    await this.dbService.query(`
      CREATE TABLE IF NOT EXISTS output_table (
        id SERIAL PRIMARY KEY,
        name_of_the_donor TEXT,
        donor_mobile_number TEXT,
        address TEXT,
        donor_blood_group TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        behavior_analysis DOUBLE PRECISION,
        distance_km DOUBLE PRECISION
      );
    `);
    await this.dbService.query('DELETE FROM output_table');
    console.log('Output table is set up and cleared.');
  }

  async getFilteredDonors(bloodGroup) {
    console.log(`Fetching donors with blood group: ${bloodGroup}`);
    const query = `
      SELECT name_of_the_donor, donor_mobile_number, address, donor_blood_group, latitude, longitude, behavior_analysis
      FROM donor_datadump
      WHERE donor_blood_group = $1 AND behavior_analysis > 4.8;
    `;
    const result = await this.dbService.query(query, [bloodGroup]);
    console.log(`Fetched ${result.rows.length} donors.`);
    return result.rows;
  }

  async saveDonorsWithDistances(latitude, longitude, donors) {
    console.log(`Saving donors with calculated distances...`);
    for (const donor of donors) {
      if (!donor.latitude || !donor.longitude) {
        console.log(`Skipping donor: ${donor.name_of_the_donor} due to missing or invalid coordinates.`);
        continue;
      }

      const distance = LocationService.calculateDistance(
        latitude,
        longitude,
        donor.latitude,
        donor.longitude
      );

      await this.dbService.query(
        `INSERT INTO output_table (name_of_the_donor, donor_mobile_number, address, donor_blood_group, latitude, longitude, behavior_analysis, distance_km)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
        [
          donor.name_of_the_donor,
          donor.donor_mobile_number,
          donor.address,
          donor.donor_blood_group,
          donor.latitude,
          donor.longitude,
          donor.behavior_analysis,
          distance,
        ]
      );
      console.log(`Saved donor: ${donor.name_of_the_donor} with distance: ${distance} km`);
    }
  }

  async getSortedDonors() {
    console.log('Fetching sorted donors by distance...');
    const query = `
      SELECT name_of_the_donor, donor_mobile_number, address, behavior_analysis, distance_km
      FROM output_table
      ORDER BY distance_km ASC;
    `;
    const result = await this.dbService.query(query);
    console.log(`Fetched ${result.rows.length} sorted donors.`);
    return result.rows;
  }
}

// DonorApp sets up the server and routes
class DonorApp {
  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.app.use(cors({ origin: 'http://localhost:3000' })); // You can set this directly

    this.dbService = new DatabaseService();
    this.donorService = new DonorService(this.dbService);
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.post('/find-donors', async (req, res) => {
      const { pincode, bloodGroup } = req.body;

      if (!pincode || !bloodGroup) {
        return res.status(400).json({ error: 'Pincode and blood group are required.' });
      }

      try {
        console.log(`Request received with pincode: ${pincode}, bloodGroup: ${bloodGroup}`);

        const { latitude, longitude } = await LocationService.getCoordinatesFromPincode(pincode);

        await this.donorService.setupOutputTable();

        const donors = await this.donorService.getFilteredDonors(bloodGroup);
        await this.donorService.saveDonorsWithDistances(latitude, longitude, donors);

        const sortedDonors = await this.donorService.getSortedDonors();
        console.log('Sending sorted donors as response');
        res.json(sortedDonors);
      } catch (error) {
        console.error(`Error during processing request: ${error.message}`);
        res.status(500).send('An error occurred while processing the request.');
      }
    });
  }

  start() {
    const port =  process.env.PORT || 5000;
  // Hardcoded port
    this.app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  }
}

// Start the application
const donorApp = new DonorApp();
donorApp.start();
