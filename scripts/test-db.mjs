import mongoose from 'mongoose';

async function testConnection() {
  const uri = process.env.MONGODB_URI;

  console.log('\n🔍 [Namozlarim] MongoDB Atlas Connection Tester');
  console.log('--------------------------------------------------');

  if (!uri) {
    console.error('❌ MONGODB_URI is not defined.');
    console.error('👉 Make sure .env.local exists and contains MONGODB_URI.');
    process.exit(1);
  }

  // Mask credentials for display
  const maskedUri = uri.replace(/\/\/(.*?):(.*?)@/, '//***:***@');
  console.log(`📡 Target URI: ${maskedUri}`);

  // Check if password placeholder is still present
  if (uri.includes('<db_password>') || uri.includes('<password>')) {
    console.error('\n⚠️  ACTION REQUIRED: Placeholder password detected!');
    console.error('👉 Please replace "<db_password>" in your .env.local file with your actual database user password.');
    console.error('   Example: mongodb+srv://insaz11k:MyActualPassword123@cluster0.l1sxcgy.mongodb.net/namozlarim?retryWrites=true&w=majority&appName=Cluster0\n');
    process.exit(1);
  }

  console.log('⏳ Connecting to MongoDB Atlas cluster...');

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log('✅ Successfully connected to MongoDB Atlas!');
    console.log(`📦 Database Name: "${conn.connection.name}"`);
    console.log(`🌐 Cluster Host:  ${conn.connection.host}`);
    console.log(`⚡ Ready State:   ${conn.connection.readyState === 1 ? '1 (Connected)' : conn.connection.readyState}`);

    // Quick ping command
    const ping = await conn.connection.db?.admin().ping();
    console.log('📶 Cluster Ping:  ', ping?.ok === 1 ? 'OK (Latency verified)' : ping);

    console.log('--------------------------------------------------');
    console.log('🎉 Namozlarim / Namozlarim.uz database connection is verified and ready!\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Connection Failed!');
    console.error(`Error: ${error.message}\n`);

    if (error.message.includes('bad auth') || error.message.includes('Authentication failed')) {
      console.error('💡 Authentication Issue: The password or username in MONGODB_URI is incorrect.');
      console.error('   Check MongoDB Atlas -> Database Access -> ensure user "insaz11k" exists and password matches.');
    } else if (error.message.includes('ETIMEDOUT') || error.message.includes('querySrv') || error.message.includes('Server selection timed out')) {
      console.error('💡 Network / Whitelist Issue: Your current IP address might not be allowed in Atlas.');
      console.error('   Check MongoDB Atlas -> Network Access -> Add IP Address:');
      console.error('   - Click "Add Current IP Address" OR');
      console.error('   - Allow access from anywhere (0.0.0.0/0) for development.');
    }

    console.log('--------------------------------------------------\n');
    process.exit(1);
  }
}

testConnection();
