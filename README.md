
<p align="center">
<img alt="Home Bridge logotype" src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# Homebridge Platform Aqua Temp Plugin
This is a plugin for Aqua Temp pool heater.

# Support for
1.0.0
* Water temperature

1.1.0
* Added support to turn on and off the device 

1.2.0
* Added support for getting token from username and password

1.3.0
* Added support for refreshing token
* Added support for outdoor temperature


# Default config
```json
"platforms": [
    {
        "name": "Aqua Temp Plugin",
        "Username": "[Username]",
        "Password": "[Password]",
        "UpdateTime": 60,
        "Debug": false
    }
]
```
